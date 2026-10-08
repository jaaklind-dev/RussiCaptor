import { activeExercisePackageService } from "@/services/exercise/ActiveExercisePackageService";
import { prepareProvisionalAdminExercise } from "@/services/exercise/ExercisePreparationService";
import { exercisePackageRegistry } from "@/services/exercise/ExercisePackageService";
import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import type { AdminPackageIdentity } from "./AdminPackageSelectionService";
import { grantExerciseBootstrap, revokeUnusedExerciseBootstrap,
  type ExerciseBootstrapAuthorization } from "./PlatformAdminService";
import {
  createSharedExerciseSnapshot,
  restoreSharedExerciseState,
  type SharedExerciseState,
} from "@/services/StatePersistenceService";
import { notifySync } from "@/services/SyncService";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
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
  revokeBootstrap: (bootstrapId: string, userId: string) => Promise<void>;
  prepare: (identity: AdminPackageIdentity, operationId: string, exerciseId: string) => PreparationResult;
  captureLocalState: () => SharedExerciseState;
  currentExerciseId?: () => string;
  restoreLocalState: (state: SharedExerciseState) => void;
  commitPackageSelection?: (identity: AdminPackageIdentity) => void;
  acknowledge: (input: Readonly<{
    operationId: string; userId: string; exerciseId: string;
    packageId: string; packageVersion: string; bootstrapAuthorizationId: string;
    projection?: SharedExerciseState;
  }>) => Promise<InitialExercisePublicationAcknowledgement>;
}>;

const defaultDependencies: AdminExerciseCreationDependencies = Object.freeze({
  resolvePackage: identity => exercisePackageRegistry.get(identity.packageId, identity.packageVersion),
  grantBootstrap: grantExerciseBootstrap,
  revokeBootstrap: revokeUnusedExerciseBootstrap,
  prepare: (identity, operationId, exerciseId) => {
    const pkg = exercisePackageRegistry.get(identity.packageId, identity.packageVersion);
    if (!pkg) return Object.freeze({ ok: false as const, message: "Valitud õppusepaketti ei leitud." });
    const projection = prepareProvisionalAdminExercise(`PREPARE-${operationId}`, exerciseId, pkg);
    return Object.freeze({ ok: true as const, exerciseId,
      exercisePackage: pkg, projection });
  },
  captureLocalState: createSharedExerciseSnapshot,
  currentExerciseId: () => getCanonicalExerciseSnapshot().exerciseId,
  restoreLocalState: state => { restoreSharedExerciseState(state, false); notifySync("remote"); },
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
  | "SUCCEEDED" | "FAILED";

type CreationAttempt = {
  operationId: string;
  key: string;
  phase: AdminExerciseCreationPhase;
  inFlight?: Promise<string>;
  beforeState?: SharedExerciseState;
  provisionalExerciseId?: string;
  provisionalState?: SharedExerciseState;
  prepared?: Extract<PreparationResult, { ok: true }>;
  bootstrap?: ExerciseBootstrapAuthorization;
  acknowledgement?: InitialExercisePublicationAcknowledgement;
};

const attempts = new Map<string, CreationAttempt>();
let operationSequence = 0;

export function createAdminExerciseOperationId(): string {
  operationSequence += 1;
  return `ADMIN-CREATE-${Date.now()}-${operationSequence}`;
}

export function getAdminExerciseCreationPhase(operationId: string): AdminExerciseCreationPhase {
  return attempts.get(operationId)?.phase ?? "IDLE";
}

export function resetAdminExerciseCreationAttemptsForTests(): void {
  attempts.clear();
  operationSequence = 0;
}

export function discardAdminExerciseCreationOperation(operationId: string): boolean {
  const attempt = attempts.get(operationId);
  if (attempt?.inFlight) return false;
  finishInitialExercisePublication(operationId);
  attempts.delete(operationId);
  return true;
}

function provisionalExerciseId(operationId: string): string {
  return `EX-${operationId.replace(/^ADMIN-CREATE-/, "")}`;
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
  try {
    if (!attempt.prepared) {
      attempt.beforeState = dependencies.captureLocalState();
      attempt.provisionalExerciseId = provisionalExerciseId(attempt.operationId);
      attempt.phase = "PROVISIONAL_CREATED";
      attempt.phase = "CREATING_BOOTSTRAP";
      attempt.bootstrap = await dependencies.grantBootstrap(userId);
      attempt.phase = "PACKAGE_PREPARING";
      const result = dependencies.prepare({ packageId: selected.packageId, packageVersion: selected.packageVersion },
        attempt.operationId, attempt.provisionalExerciseId);
      if (!result.ok) throw new Error(result.message);
      if (result.projection && result.exerciseId !== attempt.provisionalExerciseId) {
        throw new Error("ADMIN_EXERCISE_CREATE_IDENTITY_MISMATCH");
      }
      if (result.exercisePackage.packageId !== selected.packageId
        || result.exercisePackage.packageVersion !== selected.packageVersion
        || result.exercisePackage.packageHash !== selected.packageHash) {
        throw new Error("Loodud õppuse paketisidumine ei vasta valitud paketile.");
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
      attempt.bootstrap = await dependencies.grantBootstrap(userId);
    }
    attempt.phase = "PUBLISHING_INITIAL_STATE";
    beginInitialExercisePublication({ operationId: attempt.operationId, exerciseId: prepared.exerciseId,
      packageIdentity: identity });
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
      || acknowledgement.packageVersion !== selected.packageVersion) {
      throw new Error("ADMIN_EXERCISE_CREATE_ACK_MISMATCH");
    }
    attempt.acknowledgement = acknowledgement;
    finishInitialExercisePublication(attempt.operationId);
    fenceActive = false;
    if (prepared.projection) {
      dependencies.restoreLocalState(prepared.projection);
      dependencies.commitPackageSelection?.(identity);
    }
    attempt.phase = "SUCCEEDED";
    return prepared.exerciseId;
  } catch (error) {
    if (fenceActive) finishInitialExercisePublication(attempt.operationId);
    if (attempt.beforeState && attempt.prepared && !attempt.acknowledgement
      && (!attempt.prepared.projection || !dependencies.currentExerciseId
        || dependencies.currentExerciseId() !== attempt.beforeState.exerciseSession.exerciseId)) {
      dependencies.restoreLocalState(attempt.beforeState);
    }
    if (attempt.bootstrap && !attempt.acknowledgement) {
      try {
        await dependencies.revokeBootstrap(attempt.bootstrap.id, userId);
        attempt.bootstrap = undefined;
      } catch {
        // A lost acknowledgement may already have consumed this exact grant.
        // Preserve it for the same-operation readback on retry; never revoke by guess.
      }
    }
    attempt.phase = "FAILED";
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("ADMIN_EXERCISE_")) {
      throw new Error("Õppuse loomine ei õnnestunud. Proovi uuesti.");
    }
    throw error;
  }
}

export async function createAdminExercise(
  userId: string,
  identity: AdminPackageIdentity,
  operationId = createAdminExerciseOperationId(),
  dependencies: AdminExerciseCreationDependencies = defaultDependencies,
): Promise<string> {
  const selected = dependencies.resolvePackage(identity);
  if (!selected) throw new Error("Valitud õppusepakett pole enam saadaval. Vali pakett uuesti.");
  const key = attemptKey(userId, identity);
  const existing = attempts.get(operationId);
  if (existing && existing.key !== key) throw new Error("Õppuse loomise identiteet ei vasta valitud paketile.");
  if (existing?.phase === "SUCCEEDED" && existing.prepared) return existing.prepared.exerciseId;
  if (existing?.inFlight) return existing.inFlight;
  const attempt = existing ?? { operationId, key, phase: "IDLE" as const };
  attempts.set(operationId, attempt);
  const task = runCreationAttempt(attempt, userId, identity, selected, dependencies)
    .finally(() => { if (attempt.inFlight === task) attempt.inFlight = undefined; });
  attempt.inFlight = task;
  return task;
}
