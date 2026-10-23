import { activeExercisePackageService } from "@/services/exercise/ActiveExercisePackageService";
import { prepareProvisionalAdminExercise } from "@/services/exercise/ExercisePreparationService";
import { exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import type { AdminPackageIdentity } from "./AdminPackageSelectionService";
import { grantExerciseBootstrap, revokeUnusedExerciseBootstrap,
  type ExerciseBootstrapAuthorization } from "./PlatformAdminService";
import {
  captureAdminExerciseProjection,
  restoreAdminExerciseProjection,
  type SharedExerciseState,
} from "@/services/StatePersistenceService";
import { notifySync } from "@/services/SyncService";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { stopClockRunner } from "@/services/ClockRunner";
import { allocateServerExerciseIdentity, newExerciseAllocationRequestId, exerciseAllocationRequestId,
  type ExerciseIdentityRequest } from "@/services/exercise/ServerExerciseIdentity";
import {
  acknowledgeInitialExercisePublication,
  type InitialExercisePublicationAcknowledgement,
} from "@/services/CloudSyncService";
import {
  beginInitialExercisePublication,
  finishInitialExercisePublication,
} from "@/services/exercise/InitialExercisePublicationFence";

type PreparationResult = Readonly<{ ok: true; exerciseId: string; exercisePackage: ExercisePackage;
  projection?: SharedExerciseState }> | Readonly<{ ok: false; message: string }>;

export type AdminExerciseCreationDependencies = Readonly<{
  resolvePackage: (identity: AdminPackageIdentity) => ExercisePackage | undefined;
  grantBootstrap: (userId: string) => Promise<ExerciseBootstrapAuthorization>;
  allocateIdentity: (request: ExerciseIdentityRequest) => Promise<string>;
  revokeBootstrap: (bootstrapId: string, userId: string) => Promise<void>;
  prepare: (identity: AdminPackageIdentity, operationId: string, exerciseId: string) => PreparationResult;
  captureLocalState: () => SharedExerciseState;
  currentExerciseId?: () => string;
  restoreLocalState: (state: SharedExerciseState) => void;
  commitPackageSelection?: (identity: AdminPackageIdentity) => void;
  finishLocalActivation?: () => void;
  /** Preparation returns a detached projection and never mutates the live store. */
  detachedPreparation?: boolean;
  acknowledge: (input: Readonly<{
    operationId: string; userId: string; exerciseId: string;
    packageId: string; packageVersion: string; bootstrapAuthorizationId: string;
    projection?: SharedExerciseState;
  }>) => Promise<InitialExercisePublicationAcknowledgement>;
}>;

const defaultDependencies: AdminExerciseCreationDependencies = Object.freeze({
  resolvePackage: identity => exercisePackageRegistry.get(identity.packageId, identity.packageVersion),
  detachedPreparation: true,
  grantBootstrap: grantExerciseBootstrap,
  allocateIdentity: allocateServerExerciseIdentity,
  revokeBootstrap: revokeUnusedExerciseBootstrap,
  prepare: (identity, operationId, exerciseId) => {
    const pkg = exercisePackageRegistry.get(identity.packageId, identity.packageVersion);
    if (!pkg) return Object.freeze({ ok: false as const, message: "Valitud õppusepaketti ei leitud." });
    const projection = prepareProvisionalAdminExercise(`PREPARE-${operationId}`, exerciseId, pkg);
    return Object.freeze({ ok: true as const, exerciseId,
      exercisePackage: pkg, projection });
  },
  // This backup is never published and never captures/revalidates clinical engines.
  captureLocalState: captureAdminExerciseProjection,
  currentExerciseId: () => getCanonicalExerciseSnapshot().exerciseId,
  restoreLocalState: restoreAdminExerciseProjection,
  finishLocalActivation: () => { notifySync("remote"); stopClockRunner(); },
  commitPackageSelection: identity => {
    // The durable ACK already committed the exercise. An optional local
    // selector persistence failure must not turn that success into a retry.
    activeExercisePackageService.activateWithResult(identity.packageId, identity.packageVersion);
  },
  acknowledge: acknowledgeInitialExercisePublication,
});

export type AdminExerciseCreationPhase = "IDLE" | "CREATING_BOOTSTRAP" | "BOOTSTRAPPING_RUNTIME"
  | "PROVISIONAL_CREATED" | "PACKAGE_PREPARING" | "READY_FOR_INITIAL_PUBLICATION"
  | "PUBLISHING_INITIAL_STATE" | "WAITING_FOR_BACKEND_ACK" | "VERIFYING_DISCOVERY"
  | "CAPTURING_PREVIOUS_PROJECTION" | "ACTIVATING_LOCAL_STATE" | "ROLLING_BACK"
  | "SUCCEEDED" | "FAILED";

export type AdminCreationFailureStage = "LOCAL_PREPARATION" | "PACKAGE_VALIDATION"
  | "BOOTSTRAP_AUTHORIZATION" | "SERVER_CREATION" | "INITIAL_PUBLICATION"
  | "LOCAL_ACTIVATION" | "ROLLBACK";
export type AdminCreationDiagnostic = Readonly<{ stage: AdminCreationFailureStage;
  code: string; durableConfirmed: boolean }>;
const safeCodes = new Set(["RUNTIME_CHECKPOINT_CLOCK_MISMATCH", "RUNTIME_CHECKPOINT_EXERCISE_MISMATCH",
  "ADMIN_EXERCISE_CREATE_IDENTITY_MISMATCH", "ADMIN_EXERCISE_PACKAGE_INCOMPATIBLE",
  "ADMIN_EXERCISE_CREATE_ACK_MISMATCH", "ADMIN_EXERCISE_INITIAL_INSERT_FAILED",
  "ADMIN_EXERCISE_DURABLE_ACK_TIMEOUT", "ADMIN_EXERCISE_READBACK_FAILED",
  "ADMIN_EXERCISE_BOOTSTRAP_UNAVAILABLE", "ADMIN_EXERCISE_AUTH_MISMATCH",
  "BOOTSTRAP_GRANT_FAILED", "PLATFORM_ADMIN_REQUIRED", "AUTHENTICATION_REQUIRED"]);
const safeMessages = new Set(["Aktiivne õppus tuleb enne lõpetada.",
  "Valitud õppusepakett pole enam saadaval. Vali pakett uuesti.",
  "Loodud õppuse paketisidumine ei vasta valitud paketile."]);
export class AdminExerciseCreationError extends Error {
  constructor(readonly diagnostic: AdminCreationDiagnostic, publicMessage?: string) {
    super(publicMessage && safeMessages.has(publicMessage) ? publicMessage : diagnostic.durableConfirmed
      ? "Õppus on serveris loodud, kuid kohalik aktiveerimine ebaõnnestus. Proovi sama toimingut uuesti."
      : "Õppuse loomine ei õnnestunud. Proovi uuesti.");
    this.name = "AdminExerciseCreationError";
  }
}
function failureDiagnostic(stage: AdminCreationFailureStage, error: unknown,
  durableConfirmed: boolean): AdminCreationDiagnostic {
  const message = error instanceof Error ? error.message : "";
  return Object.freeze({ stage, code: safeCodes.has(message) ? message : `ADMIN_CREATION_${stage}_FAILED`,
    durableConfirmed });
}

type CreationAttempt = {
  operationId: string;
  allocationRequestId: string;
  allocationStarted?: boolean;
  key: string;
  phase: AdminExerciseCreationPhase;
  inFlight?: Promise<string>;
  beforeState?: SharedExerciseState;
  provisionalExerciseId?: string;
  provisionalState?: SharedExerciseState;
  prepared?: Extract<PreparationResult, { ok: true }>;
  bootstrap?: ExerciseBootstrapAuthorization;
  acknowledgement?: InitialExercisePublicationAcknowledgement;
  diagnostic?: AdminCreationDiagnostic;
  rollbackPending?: boolean;
};

const attempts = new Map<string, CreationAttempt>();

export function createAdminExerciseOperationId(): string {
  return `ADMIN-CREATE-${newExerciseAllocationRequestId()}`;
}

export function getAdminExerciseCreationPhase(operationId: string): AdminExerciseCreationPhase {
  return attempts.get(operationId)?.phase ?? "IDLE";
}
export function getAdminExerciseCreationDiagnostic(operationId: string): AdminCreationDiagnostic | undefined {
  return attempts.get(operationId)?.diagnostic;
}

export function resetAdminExerciseCreationAttemptsForTests(): void {
  attempts.clear();
}

export function discardAdminExerciseCreationOperation(operationId: string): boolean {
  const attempt = attempts.get(operationId);
  if (attempt?.inFlight || attempt?.rollbackPending) return false;
  finishInitialExercisePublication(operationId);
  attempts.delete(operationId);
  return true;
}

function attemptKey(userId: string, identity: AdminPackageIdentity): string {
  return `${userId}\n${identity.packageId}\n${identity.packageVersion}`;
}

async function runCreationAttempt(
  attempt: CreationAttempt,
  userId: string,
  identity: AdminPackageIdentity,
  selected: ExercisePackage,
  dependencies: AdminExerciseCreationDependencies,
): Promise<string> {
  let fenceActive = false;
  let stage: AdminCreationFailureStage = "LOCAL_PREPARATION";
  let activationStarted = false;
  try {
    attempt.diagnostic = undefined;
    if (attempt.rollbackPending && attempt.beforeState) {
      stage = "ROLLBACK";
      dependencies.restoreLocalState(attempt.beforeState);
      attempt.rollbackPending = false;
    }
    if (!attempt.prepared) {
      attempt.phase = "CAPTURING_PREVIOUS_PROJECTION";
      if (!dependencies.detachedPreparation) attempt.beforeState = dependencies.captureLocalState();
      attempt.phase = "CREATING_BOOTSTRAP";
      stage = "BOOTSTRAP_AUTHORIZATION";
      attempt.bootstrap ??= await dependencies.grantBootstrap(userId);
      // Retain the exact token/request binding even after a lost allocation ACK.
      // Replacing a token on retry would create a second reservation or conflict.
      attempt.allocationStarted = true;
      attempt.provisionalExerciseId ??= await dependencies.allocateIdentity({
        requestId: attempt.allocationRequestId, bootstrapId: attempt.bootstrap.id, purpose: "ADMIN",
      });
      attempt.phase = "PROVISIONAL_CREATED";
      attempt.phase = "PACKAGE_PREPARING";
      stage = "LOCAL_PREPARATION";
      const result = dependencies.prepare({ packageId: selected.packageId, packageVersion: selected.packageVersion },
        attempt.operationId, attempt.provisionalExerciseId);
      if (!result.ok) throw new Error(result.message);
      stage = "PACKAGE_VALIDATION";
      if (dependencies.detachedPreparation && !result.projection) {
        throw new Error("ADMIN_EXERCISE_PROJECTION_MISMATCH");
      }
      if (result.exercisePackage.packageId !== selected.packageId
        || result.exercisePackage.packageVersion !== selected.packageVersion
        || result.exercisePackage.packageHash !== selected.packageHash) {
        throw new Error("Loodud õppuse paketisidumine ei vasta valitud paketile.");
      }
      if (result.exerciseId !== attempt.provisionalExerciseId) {
        throw new Error("ADMIN_EXERCISE_CREATE_IDENTITY_MISMATCH");
      }
      attempt.prepared = result;
      attempt.provisionalState = result.projection ?? dependencies.captureLocalState();
      attempt.phase = "READY_FOR_INITIAL_PUBLICATION";
    } else if (attempt.provisionalState && !attempt.prepared.projection) {
      // A transient ACK failure rolls the visible store back, but a retry of
      // the same operation restores the exact provisional identity instead of
      // allocating a second exercise.
      dependencies.restoreLocalState(attempt.provisionalState);
    }

    const prepared = attempt.prepared;
    if (!prepared) throw new Error("Õppuse loomine ei õnnestunud. Proovi uuesti.");
    if (!attempt.bootstrap) {
      attempt.phase = "CREATING_BOOTSTRAP";
      stage = "BOOTSTRAP_AUTHORIZATION";
      attempt.bootstrap = await dependencies.grantBootstrap(userId);
    }
    if (!attempt.acknowledgement) {
      stage = "INITIAL_PUBLICATION";
      attempt.phase = "PUBLISHING_INITIAL_STATE";
      beginInitialExercisePublication({ operationId: attempt.operationId, exerciseId: prepared.exerciseId,
        packageIdentity: identity, preserveLocalUntilAcknowledged: dependencies.detachedPreparation === true });
      fenceActive = true;
      attempt.phase = "WAITING_FOR_BACKEND_ACK";
      const acknowledgement = await dependencies.acknowledge({
        operationId: attempt.operationId,
        userId,
        exerciseId: prepared.exerciseId,
        packageId: selected.packageId,
        packageVersion: selected.packageVersion,
        bootstrapAuthorizationId: attempt.bootstrap.id,
        ...(prepared.projection ? { projection: prepared.projection } : {}),
      });
      attempt.phase = "VERIFYING_DISCOVERY";
      if (acknowledgement.exerciseId !== prepared.exerciseId
        || acknowledgement.packageId !== selected.packageId
        || acknowledgement.packageVersion !== selected.packageVersion
        || acknowledgement.revision !== 1
        || acknowledgement.bootstrapAuthorizationId !== attempt.bootstrap.id) {
        throw new Error("ADMIN_EXERCISE_CREATE_ACK_MISMATCH");
      }
      attempt.acknowledgement = acknowledgement;
    }
    finishInitialExercisePublication(attempt.operationId);
    fenceActive = false;
    if (prepared.projection) {
      stage = "LOCAL_ACTIVATION";
      attempt.phase = "ACTIVATING_LOCAL_STATE";
      // Capture a fresh local-only rollback projection at the synchronous
      // replacement boundary, not before the asynchronous server operation.
      attempt.beforeState = dependencies.captureLocalState();
      activationStarted = true;
      dependencies.restoreLocalState(prepared.projection);
      dependencies.commitPackageSelection?.(identity);
      dependencies.finishLocalActivation?.();
    }
    attempt.phase = "SUCCEEDED";
    return prepared.exerciseId;
  } catch (error) {
    if (fenceActive) finishInitialExercisePublication(attempt.operationId);
    let rollbackError: unknown;
    if (attempt.beforeState && (activationStarted || (attempt.prepared && !attempt.acknowledgement
      && (!attempt.prepared.projection || !dependencies.currentExerciseId
        || dependencies.currentExerciseId() !== attempt.beforeState.exerciseSession.exerciseId)))) {
      attempt.phase = "ROLLING_BACK";
      attempt.rollbackPending = true;
      try {
        dependencies.restoreLocalState(attempt.beforeState);
        attempt.rollbackPending = false;
      } catch (caught) { rollbackError = caught; }
    }
    if (attempt.bootstrap && !attempt.acknowledgement && !attempt.allocationStarted) {
      try {
        await dependencies.revokeBootstrap(attempt.bootstrap.id, userId);
        attempt.bootstrap = undefined;
      } catch {
        // A lost acknowledgement may already have consumed this exact grant.
        // Preserve it for the same-operation readback on retry; never revoke by guess.
      }
    }
    attempt.phase = "FAILED";
    const code = error instanceof Error ? error.message : "";
    if (stage === "LOCAL_PREPARATION" && code === "ADMIN_EXERCISE_PACKAGE_INCOMPATIBLE") stage = "PACKAGE_VALIDATION";
    if (stage === "INITIAL_PUBLICATION" && code === "ADMIN_EXERCISE_INITIAL_INSERT_FAILED") stage = "SERVER_CREATION";
    attempt.diagnostic = failureDiagnostic(rollbackError ? "ROLLBACK" : stage,
      rollbackError ?? error, Boolean(attempt.acknowledgement));
    // Log only an allowlisted category/code, never the exception or payload.
    console.warn("ADMIN_EXERCISE_CREATION_FAILED", attempt.diagnostic);
    throw new AdminExerciseCreationError(attempt.diagnostic, error instanceof Error ? error.message : undefined);
  }
}

export async function createAdminExercise(
  userId: string,
  identity: AdminPackageIdentity,
  operationId = createAdminExerciseOperationId(),
  dependencies: AdminExerciseCreationDependencies = defaultDependencies,
): Promise<string> {
  let selected: ExercisePackage | undefined;
  try {
    selected = dependencies.resolvePackage(identity);
    if (!selected) throw new Error("Valitud õppusepakett pole enam saadaval. Vali pakett uuesti.");
  } catch (error) {
    const diagnostic = failureDiagnostic("PACKAGE_VALIDATION", error, false);
    console.warn("ADMIN_EXERCISE_CREATION_FAILED", diagnostic);
    throw new AdminExerciseCreationError(diagnostic, error instanceof Error ? error.message : undefined);
  }
  const key = attemptKey(userId, identity);
  const existing = attempts.get(operationId);
  if (existing && existing.key !== key) throw new Error("Õppuse loomise identiteet ei vasta valitud paketile.");
  if (existing?.phase === "SUCCEEDED" && existing.prepared) return existing.prepared.exerciseId;
  if (existing?.inFlight) return existing.inFlight;
  const attempt = existing ?? { operationId, allocationRequestId: exerciseAllocationRequestId(userId, operationId), key, phase: "IDLE" as const };
  attempts.set(operationId, attempt);
  const task = runCreationAttempt(attempt, userId, identity, selected, dependencies)
    .finally(() => { if (attempt.inFlight === task) attempt.inFlight = undefined; });
  attempt.inFlight = task;
  return task;
}

/** Shared detached creation path; ordinary callers supply an existing authority,
 * never invoke the platform-admin grant endpoint or fall back to a local ID. */
export function createExerciseWithExistingBootstrap(
  userId: string, identity: AdminPackageIdentity, operationId: string,
  bootstrap: () => Promise<ExerciseBootstrapAuthorization>,
  beforeActivation: () => void,
): Promise<string> {
  return createAdminExercise(userId, identity, operationId, {
    ...defaultDependencies,
    grantBootstrap: bootstrap,
    allocateIdentity: request => allocateServerExerciseIdentity({ ...request, purpose: "CREATE" }),
    restoreLocalState: state => { beforeActivation(); defaultDependencies.restoreLocalState(state); },
  });
}
