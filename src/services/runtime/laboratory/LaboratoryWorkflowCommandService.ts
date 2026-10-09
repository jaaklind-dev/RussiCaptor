import type { LaboratoryWorkflowSnapshot, NarvaLabPackageId } from "@/models/LaboratoryWorkflow";
import type { RuntimePatientCommandSubmissionResult } from "@/models/RuntimePatientCommand";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { narvaLabPackageForExercisePackage } from "@/config/NarvaLaboratoryCatalog";
import { getExercisePackage } from "@/services/exercise/ExercisePackageService";
import { submitPatientRuntimeCommand } from "@/services/runtime/commands/RuntimePatientCommandService";

export type LaboratoryWorkflowCommandOutcome = Readonly<{
  ok: boolean;
  message: string;
  commandId: string;
  status: RuntimePatientCommandSubmissionResult["status"];
  commandSequence?: number;
}>;

export function laboratoryPackageForActiveExercise(exerciseId: string): NarvaLabPackageId | undefined {
  const pkg = getExercisePackage(exerciseId);
  return pkg.laboratoryConfiguration?.catalogPackageId ?? narvaLabPackageForExercisePackage(pkg.packageId);
}

export function createLaboratoryOrderCommandId(
  exerciseId: string,
  patientId: string,
  packageId: NarvaLabPackageId,
  workflow: LaboratoryWorkflowSnapshot | undefined,
): string {
  const ordinal = (workflow?.orders.filter(item => item.patientId === patientId && item.packageId === packageId).length ?? 0) + 1;
  return `LAB-ORDER-INTENT:${exerciseId}:${patientId}:${packageId}:${ordinal}`;
}

export function createLaboratoryCollectCommandId(exerciseId: string, patientId: string, orderId: string): string {
  return `LAB-COLLECT-INTENT:${exerciseId}:${patientId}:${orderId}`;
}

function outcome(commandId: string, result: RuntimePatientCommandSubmissionResult, successMessage: string): LaboratoryWorkflowCommandOutcome {
  const ok = result.status === "APPLIED" || result.status === "IDEMPOTENT";
  const failure = result.status === "RECONNECT_REQUIRED"
    ? "Oota patsiendi andmete sünkroonimist ja proovi uuesti."
    : result.status === "COMPLETION_FENCED" || result.status === "EXERCISE_NOT_ACTIVE"
      ? "Õppus lõpetatakse või on lõpetatud."
      : result.status === "NOT_OWNER" || result.status === "STALE_VERSION"
        ? "Patsiendi vastutus või seis muutus. Värskenda vaadet."
        : "Laborikäsku ei saanud tööjärjekorda saata.";
  return Object.freeze({ ok, message: ok ? successMessage : failure, commandId, status: result.status,
    ...(result.commandSequence === undefined ? {} : { commandSequence: result.commandSequence }) });
}

export async function submitLaboratoryOrder(
  patientId: string,
  workflow: LaboratoryWorkflowSnapshot | undefined,
): Promise<LaboratoryWorkflowCommandOutcome> {
  const exercise = getCanonicalExerciseSnapshot();
  const packageId = laboratoryPackageForActiveExercise(exercise.exerciseId);
  if (exercise.lifecycleState !== "RUNNING" || !packageId) {
    return Object.freeze({ ok: false, message: "Selle õppuse laboripakett ei ole tellitav.",
      commandId: "LAB-ORDER-UNAVAILABLE", status: "EXERCISE_NOT_ACTIVE" });
  }
  const commandId = createLaboratoryOrderCommandId(exercise.exerciseId, patientId, packageId, workflow);
  const result = await submitPatientRuntimeCommand({ exerciseId: exercise.exerciseId, patientId, commandId,
    commandType: "LAB_ORDER", payload: Object.freeze({ labPackageId: packageId }) });
  return outcome(commandId, result, "Labor telliti. Oota autoritatiivset kinnitust.");
}

export async function submitLaboratoryCollection(
  patientId: string,
  orderId: string,
): Promise<LaboratoryWorkflowCommandOutcome> {
  const exercise = getCanonicalExerciseSnapshot();
  if (exercise.lifecycleState !== "RUNNING") {
    return Object.freeze({ ok: false, message: "Õppus lõpetatakse või on lõpetatud.",
      commandId: "LAB-COLLECT-UNAVAILABLE", status: "EXERCISE_NOT_ACTIVE" });
  }
  const commandId = createLaboratoryCollectCommandId(exercise.exerciseId, patientId, orderId);
  const result = await submitPatientRuntimeCommand({ exerciseId: exercise.exerciseId, patientId, commandId,
    commandType: "LAB_COLLECT", payload: Object.freeze({ orderId }) });
  return outcome(commandId, result, "Proov koguti. Oota autoritatiivset kinnitust.");
}
