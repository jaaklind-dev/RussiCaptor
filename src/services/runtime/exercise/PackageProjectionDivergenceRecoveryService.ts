import type { RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { isValidRuntimeCheckpointAsync } from "@/services/runtime/persistence/RuntimeCheckpointAuthorityService";
import type { PipelineYield } from "@/services/runtime/persistence/LatestGenerationPipeline";

export type ExerciseProjectionRecord = Readonly<{
  exerciseId: string;
  revision: number;
  state: SharedExerciseState;
}>;

export type PackageProjectionDivergenceRecoveryCode =
  | "TERMINALIZED_DIVERGENT_STATE"
  | "ALREADY_TERMINAL"
  | "NOT_DIVERGENT"
  | "ACTIVE_LEASE_PRESENT"
  | "CHECKPOINT_INVALID"
  | "NEWER_CHECKPOINT_EXISTS"
  | "PACKAGE_IDENTITY_AMBIGUOUS"
  | "SESSION_VERSION_MISMATCH"
  | "LIFECYCLE_CONFLICT"
  | "RECOVERY_NOT_AUTHORIZED"
  | "MISSING_CHECKPOINT"
  | "RECOVERY_NOT_REQUIRED"
  | "RECOVERY_BACKEND_FAILED";

export type PackageIdentity = Readonly<{ packageId: string; packageVersion: string }>;

export type PackageDivergenceRecoveryExpectation = Readonly<{
  exerciseId: string;
  projectionRevision: number;
  checkpointRevision: number;
  payloadHash: string;
  provenanceHash: string;
  sessionVersion: number;
  lifecycle: "RUNNING" | "PAUSED";
  projectionPackage: PackageIdentity;
  checkpointPackage: PackageIdentity;
}>;

export type PackageDivergenceRecoveryRepository = Readonly<{
  loadProjection(exerciseId: string): Promise<ExerciseProjectionRecord | undefined>;
  loadCheckpoint(exerciseId: string): Promise<RuntimeCheckpointEnvelope<SharedExerciseState> | undefined>;
  hasActiveWriterLease(exerciseId: string): Promise<boolean>;
  terminalize(expectation: PackageDivergenceRecoveryExpectation): Promise<Readonly<{
    code: PackageProjectionDivergenceRecoveryCode;
    auditId?: string;
    state?: SharedExerciseState;
  }>>;
}>;

function lifecycleOf(state: SharedExerciseState): string {
  const session = state.exerciseSession;
  return "lifecycleState" in session ? session.lifecycleState
    : session.state === "running" ? "RUNNING" : session.state === "paused" ? "PAUSED" : "READY";
}

function sessionVersionOf(state: SharedExerciseState): number | undefined {
  const version = "version" in state.exerciseSession ? state.exerciseSession.version : undefined;
  return Number.isSafeInteger(version) && Number(version) >= 0 ? Number(version) : undefined;
}

export function packageIdentityOf(state: SharedExerciseState): PackageIdentity | undefined {
  const reference = state.exercisePackageReference;
  return reference && typeof reference.packageId === "string" && reference.packageId.trim() &&
    typeof reference.packageVersion === "string" && reference.packageVersion.trim()
    ? Object.freeze({ packageId: reference.packageId, packageVersion: reference.packageVersion })
    : undefined;
}

export function packageIdentityMatches(a: PackageIdentity | undefined, b: PackageIdentity | undefined): boolean {
  return Boolean(a && b && a.packageId === b.packageId && a.packageVersion === b.packageVersion);
}

/**
 * Defines the only non-terminal state eligible for package-divergence
 * recovery. The checkpoint has already passed the complete canonical/hash
 * validator before this predicate is called.
 */
export function evaluatePackageProjectionDivergence(
  projection: ExerciseProjectionRecord | undefined,
  checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
  checkpointValid: boolean,
  activeLease: boolean,
): Readonly<{ code: PackageProjectionDivergenceRecoveryCode | "ELIGIBLE"; expectation?: PackageDivergenceRecoveryExpectation }> {
  if (!projection) return Object.freeze({ code: "RECOVERY_NOT_REQUIRED" });
  if (activeLease) return Object.freeze({ code: "ACTIVE_LEASE_PRESENT" });
  if (!checkpoint) return Object.freeze({ code: "MISSING_CHECKPOINT" });
  if (!checkpointValid) return Object.freeze({ code: "CHECKPOINT_INVALID" });
  if (projection.exerciseId !== checkpoint.exerciseId ||
    projection.state.exerciseSession.exerciseId !== projection.exerciseId ||
    checkpoint.payload.exerciseSession.exerciseId !== checkpoint.exerciseId) {
    return Object.freeze({ code: "PACKAGE_IDENTITY_AMBIGUOUS" });
  }
  const projectionLifecycle = lifecycleOf(projection.state);
  const checkpointLifecycle = lifecycleOf(checkpoint.payload);
  if (projectionLifecycle === "COMPLETED") return Object.freeze({ code: "ALREADY_TERMINAL" });
  if ((projectionLifecycle !== "RUNNING" && projectionLifecycle !== "PAUSED") ||
    checkpointLifecycle !== projectionLifecycle) return Object.freeze({ code: "LIFECYCLE_CONFLICT" });
  const projectionVersion = sessionVersionOf(projection.state);
  const checkpointVersion = sessionVersionOf(checkpoint.payload);
  if (projectionVersion === undefined || checkpointVersion === undefined || projectionVersion !== checkpointVersion) {
    return Object.freeze({ code: "SESSION_VERSION_MISMATCH" });
  }
  const projectionPackage = packageIdentityOf(projection.state);
  const checkpointPackage = packageIdentityOf(checkpoint.payload);
  if (!projectionPackage || !checkpointPackage) return Object.freeze({ code: "PACKAGE_IDENTITY_AMBIGUOUS" });
  if (packageIdentityMatches(projectionPackage, checkpointPackage)) return Object.freeze({ code: "NOT_DIVERGENT" });
  return Object.freeze({ code: "ELIGIBLE", expectation: Object.freeze({
    exerciseId: projection.exerciseId,
    projectionRevision: projection.revision,
    checkpointRevision: checkpoint.checkpointRevision,
    payloadHash: checkpoint.payloadHash,
    provenanceHash: checkpoint.provenanceHash,
    sessionVersion: projectionVersion,
    lifecycle: projectionLifecycle,
    projectionPackage,
    checkpointPackage,
  }) });
}

export class PackageProjectionDivergenceRecoveryService {
  constructor(
    private readonly repository: PackageDivergenceRecoveryRepository,
    private readonly yieldControl: PipelineYield = () => new Promise(resolve => setTimeout(resolve, 0)),
  ) {}

  async terminalize(exerciseId: string): Promise<Readonly<{
    code: PackageProjectionDivergenceRecoveryCode;
    auditId?: string;
    state?: SharedExerciseState;
  }>> {
    try {
      const [projection, checkpoint, activeLease] = await Promise.all([
        this.repository.loadProjection(exerciseId),
        this.repository.loadCheckpoint(exerciseId),
        this.repository.hasActiveWriterLease(exerciseId),
      ]);
      const valid = checkpoint ? await isValidRuntimeCheckpointAsync(checkpoint, this.yieldControl) : false;
      const eligibility = evaluatePackageProjectionDivergence(projection, checkpoint, valid, activeLease);
      if (!eligibility.expectation) return Object.freeze({ code: eligibility.code as PackageProjectionDivergenceRecoveryCode });
      return await this.repository.terminalize(eligibility.expectation);
    } catch {
      return Object.freeze({ code: "RECOVERY_BACKEND_FAILED" });
    }
  }
}
