import { isSharedWorkflowValidationHarnessEnabled } from "@/config/SharedWorkflowValidationHarness";
import { getCanonicalExerciseSnapshot, subscribeToCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { activeAssignments, activeScopedExerciseIds, getOperatorAuthSessionGeneration, getOperatorSession, hasActiveRole, subscribeOperatorSession } from "@/services/authorization/OperatorSessionService";
import { exercisePackageRegistry, getExercisePackage, subscribeToExercisePackageBindings } from "@/services/exercise/ExercisePackageService";
import { RUNTIME_CONTINUITY_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { notifySync } from "@/services/SyncService";
import { findPatientById } from "@/repositories/PatientRepository";
import { createId } from "@/utils/id";
import { capturePatientSharedWorkflowState, restoreAuthoritativePatientSharedWorkflowState, type PatientSharedWorkflowState } from "./PatientSharedWorkflowState";
import { getSharedWorkflowHead, getSharedWorkflowOperationalState, submitSharedWorkflowMutation } from "./SharedWorkflowMutationService";
import { PhysicalValidationHarnessCore, type PreparedPhysicalValidationMutation, type ValidationContext } from "./PhysicalValidationHarnessCore";
export type { PreparedPhysicalValidationMutation, PhysicalValidationOutcome } from "./PhysicalValidationHarnessCore";

function context(): ValidationContext {
  const exercise = getCanonicalExerciseSnapshot(), operator = getOperatorSession(), pkg = getExercisePackage(exercise.exerciseId);
  // The loader composes clinical modules before hashing. Compare the installed
  // package with that canonical registry entry, not the uncomposed source hash.
  const reference = exercisePackageRegistry.require(RUNTIME_CONTINUITY_EXERCISE_PACKAGE.packageId, RUNTIME_CONTINUITY_EXERCISE_PACKAGE.packageVersion);
  const authenticated = operator.state === "AUTHENTICATED";
  return {
    enabled: isSharedWorkflowValidationHarnessEnabled(), exerciseId: exercise.exerciseId,
    operatorId: authenticated ? operator.principal.userId : "", sessionGeneration: getOperatorAuthSessionGeneration(),
    running: exercise.lifecycleState === "RUNNING" && getCurrentExercise().id === exercise.exerciseId,
    testPackage: pkg.packageId === RUNTIME_CONTINUITY_EXERCISE_PACKAGE.packageId &&
      pkg.packageVersion === reference.packageVersion && pkg.packageHash === reference.packageHash,
    online: getSharedWorkflowOperationalState().online,
    patientId: "PT-PELVIC-001",
    scopedCmOnly: authenticated && operator.profile.userId === operator.principal.userId &&
      operator.principal.authorizationFreshness === "VERIFIED_ONLINE" &&
      operator.principal.authorizationProvenance.expiresAt > new Date().toISOString() &&
      operator.principal.permissions.includes("CM_WORKFLOW_WRITE") &&
      activeScopedExerciseIds(operator, "CM").includes(exercise.exerciseId) &&
      !hasActiveRole(operator, "EXCON", exercise.exerciseId) &&
      !activeAssignments(operator.principal.roleAssignments).some(a => a.scope.scopeType === "GLOBAL"),
  };
}
const harness = new PhysicalValidationHarnessCore({ context, id: createId, now: () => new Date().toISOString(),
  head: patientId => getSharedWorkflowHead(getCanonicalExerciseSnapshot().exerciseId, patientId),
  patientActive: patientId => ["Active", "Incoming"].includes(findPatientById(patientId)?.status ?? ""),
  submit: submitSharedWorkflowMutation,
  apply(prepared, result) {
    if (!result.state || result.revision < getSharedWorkflowHead(prepared.exerciseId, prepared.patientId).revision) return;
    restoreAuthoritativePatientSharedWorkflowState({ exerciseId: prepared.exerciseId, patientId: prepared.patientId,
      revision: result.revision, ownerUserId: result.ownerUserId, state: result.state as PatientSharedWorkflowState, allowRuntimeAdvance: true });
    notifySync(result.status === "APPLIED" || result.status === "IDEMPOTENT" ? "device" : "remote");
  },
});
let stops: (() => void)[] = [];
export function disarmPhysicalValidationHarness(): void { harness.invalidate(); stops.forEach(stop => stop()); stops = []; }
export function isPhysicalValidationContextArmed(): boolean { return harness.valid(); }
/** Explicit operator acknowledgement, exact technical package and scoped Auth; never an entitlement. */
export function armPhysicalValidationHarness(clientRef: "Samsung-A" | "Samsung-B"): boolean {
  disarmPhysicalValidationHarness();
  if (!harness.arm(clientRef)) return false;
  const verify = () => { if (!harness.valid()) disarmPhysicalValidationHarness(); };
  stops = [subscribeOperatorSession(verify), subscribeToCanonicalExerciseSnapshot(verify), subscribeToExercisePackageBindings(verify)];
  return true;
}
export function getPhysicalValidationEvidence() { return harness.evidenceVisible() ? harness.getEvidence() : []; }
export function getPreparedValidationAvailability(prepared: PreparedPhysicalValidationMutation) { return harness.availability(prepared); }
export function canArmPhysicalValidationHarness() { return harness.canArm(); }
export function subscribePhysicalValidationContext(listener: () => void) {
  const stop = [subscribeOperatorSession(listener), subscribeToCanonicalExerciseSnapshot(listener), subscribeToExercisePackageBindings(listener)];
  return () => stop.forEach(fn => fn());
}
function inputs(patientId: string) {
  const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
  return { head: getSharedWorkflowHead(exerciseId, patientId), state: capturePatientSharedWorkflowState(patientId) };
}
export function prepareValidationClaim(patientId: string) {
  const { head, state } = inputs(patientId); return harness.prepare("CLAIM", patientId, head, state);
}
export function prepareSameBaseAppendPair(patientId: string) {
  const { head, state } = inputs(patientId); return harness.prepareAppendPair(patientId, head, state);
}
export function prepareStaleFormerOwnerMutation(patientId: string) {
  const { head, state } = inputs(patientId); return harness.prepare("MUTABLE", patientId, head, state);
}
export const prepareSameBaseMutableMutation = prepareStaleFormerOwnerMutation;
export function submitPreparedPhysicalValidationMutation(prepared: PreparedPhysicalValidationMutation) { return harness.submit(prepared); }
/** Called only after explicit negative TEST confirmation; never changes the frozen request. */
export function submitNegativePhysicalValidationMutation(prepared: PreparedPhysicalValidationMutation) { return harness.submit(prepared, true); }
