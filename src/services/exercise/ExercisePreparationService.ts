import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { clearPreparedExerciseWorkingData } from "@/services/ExerciseResetService";
import { getAnalyticsReport } from "@/services/AnalyticsService";
import { getDebriefReport } from "@/services/DebriefService";
import { getProtocolAssessmentReport } from "@/services/ProtocolAssessmentService";
import { notifySync } from "@/services/SyncService";
import { executeExerciseReset, type ExerciseResetCommand } from "@/services/runtime/exercise/ExerciseResetService";
import { activeExercisePackageService } from "./ActiveExercisePackageService";
import { storeCompletedExerciseArchive } from "./CompletedExerciseArchiveService";
import { exercisePackageLoader, exercisePackageValidator } from "./ExercisePackageService";
import type { MaterializedPatientDataset } from "@/models/exercise/PackagePatientDataset";
import { packagePatientDatasetRegistry } from "./CanonicalPatientDatasets";
import { createPatientMaterializationPlan, installPatientMaterialization, PatientDatasetError } from "./PackagePatientMaterializationService";

export type ExercisePreparationFailureCode = "ACTIVE_EXERCISE" | "NO_ACTIVE_PACKAGE" | "PACKAGE_NOT_FOUND" | "PACKAGE_INCOMPATIBLE" | "PACKAGE_BINDING_FAILED" | "PATIENT_DATASET_INVALID" | "PROTOCOL_INCOMPATIBLE" | "MODULE_COMPOSITION_FAILED" | "INVALID_EXERCISE_STATE" | "PERSISTENCE_FAILURE" | "RUNTIME_INITIALIZATION_FAILURE" | "VERSION_CONFLICT" | "UNAUTHORIZED";
export type ExercisePreparationCommand = Readonly<{ commandId: string; currentExerciseId: string; newExerciseId: string; expectedVersion: number; issuedBy: "Exercise Controller" }>;
export type ExercisePreparationResult = Readonly<{ ok: true; exerciseId: string; exercisePackage: ExercisePackage } | { ok: false; code: ExercisePreparationFailureCode; message: string }>;
type Dependencies = Readonly<{
  snapshot: typeof getCanonicalExerciseSnapshot; activePackage: typeof activeExercisePackageService.getActive;
  compatibility: typeof exercisePackageValidator.compatibility; bind(exerciseId: string, pkg: ExercisePackage): ExercisePackage; unbind(exerciseId: string): void;
  reset(command: ExerciseResetCommand): ReturnType<typeof executeExerciseReset>; capture(): ReturnType<typeof captureCompleted>; archive: typeof storeCompletedExerciseArchive;
  plan(exerciseId: string, pkg: ExercisePackage): MaterializedPatientDataset; install(plan: MaterializedPatientDataset): void;
  clear(): void; publish(): void;
}>;

let sequence = 0;
export function createExercisePreparationCommand(): ExercisePreparationCommand {
  const current = getCanonicalExerciseSnapshot(); sequence += 1; const intent = `${Date.now()}-${sequence}`;
  return Object.freeze({ commandId: `PREPARE-${intent}`, currentExerciseId: current.exerciseId, newExerciseId: `EX-${intent}`, expectedVersion: current.version, issuedBy: "Exercise Controller" });
}
function captureCompleted() { const snapshot = getCanonicalExerciseSnapshot(); const assessment = getProtocolAssessmentReport(); return Object.freeze({ exerciseId: snapshot.exerciseId, snapshot, debrief: getDebriefReport(), analytics: getAnalyticsReport(), ...(assessment ? { protocolAssessment: assessment } : {}) }); }
const message: Record<ExercisePreparationFailureCode, string> = { ACTIVE_EXERCISE: "Complete the current exercise before preparing another.", NO_ACTIVE_PACKAGE: "Select an Exercise Package before preparing a new exercise.", PACKAGE_NOT_FOUND: "The selected Exercise Package is no longer available.", PACKAGE_INCOMPATIBLE: "The selected Exercise Package is incompatible.", PACKAGE_BINDING_FAILED: "The Exercise Package could not be bound.", PATIENT_DATASET_INVALID: "The package patient dataset is missing or invalid.", PROTOCOL_INCOMPATIBLE: "The selected protocol is incompatible.", MODULE_COMPOSITION_FAILED: "Clinical Module composition failed.", INVALID_EXERCISE_STATE: "A new exercise can be prepared only after completion.", PERSISTENCE_FAILURE: "The new exercise could not be persisted.", RUNTIME_INITIALIZATION_FAILURE: "The exercise runtime could not be initialized.", VERSION_CONFLICT: "Exercise state changed. Try again.", UNAUTHORIZED: "Exercise Controller authorization is required." };
const failure = (code: ExercisePreparationFailureCode): ExercisePreparationResult => Object.freeze({ ok: false, code, message: message[code] });

export class ExercisePreparationService {
  private readonly results = new Map<string, ExercisePreparationResult>();
  constructor(private readonly dependencies: Dependencies) {}
  prepare(command: ExercisePreparationCommand): ExercisePreparationResult {
    const prior = this.results.get(command.commandId); if (prior) return prior;
    const current = this.dependencies.snapshot(); let result: ExercisePreparationResult;
    if (command.issuedBy !== "Exercise Controller") result = failure("UNAUTHORIZED");
    else if (command.currentExerciseId !== current.exerciseId || command.expectedVersion !== current.version) result = failure("VERSION_CONFLICT");
    else if (current.lifecycleState === "RUNNING" || current.lifecycleState === "PAUSED") result = failure("ACTIVE_EXERCISE");
    else if (current.lifecycleState !== "COMPLETED") result = failure("INVALID_EXERCISE_STATE");
    else {
      const pkg = this.dependencies.activePackage();
      if (!pkg) result = failure("NO_ACTIVE_PACKAGE");
      else if (this.dependencies.compatibility(pkg) === "INCOMPATIBLE") result = failure("PACKAGE_INCOMPATIBLE");
      else {
        let plan: MaterializedPatientDataset | undefined;
        try { plan = this.dependencies.plan(command.newExerciseId, pkg); }
        catch (error) { result = failure(error instanceof PatientDatasetError ? "PATIENT_DATASET_INVALID" : "PERSISTENCE_FAILURE"); }
        let history: ReturnType<typeof captureCompleted> | undefined;
        try { if (plan) history = this.dependencies.capture(); }
        catch { result = failure("PERSISTENCE_FAILURE"); }
        let bound = false;
        if (history) {
        try { this.dependencies.bind(command.newExerciseId, pkg); bound = true; }
        catch (error) { const text = String(error); result = failure(text.includes("PROTOCOL") ? "PROTOCOL_INCOMPATIBLE" : text.includes("MODULE") ? "MODULE_COMPOSITION_FAILED" : "PACKAGE_BINDING_FAILED"); }
        if (bound) {
          const reset = this.dependencies.reset(command);
          if (!reset.ok) { this.dependencies.unbind(command.newExerciseId); result = failure(reset.audit.reasonCode === "VERSION_CONFLICT" ? "VERSION_CONFLICT" : reset.audit.reasonCode === "UNAUTHORIZED" ? "UNAUTHORIZED" : reset.audit.reasonCode === "ACTIVE_EXERCISE" ? "ACTIVE_EXERCISE" : "INVALID_EXERCISE_STATE"); }
          else { this.dependencies.archive(history); this.dependencies.clear(); this.dependencies.install(plan!); this.dependencies.publish(); result = Object.freeze({ ok: true, exerciseId: reset.snapshot.exerciseId, exercisePackage: pkg }); }
        }
        }
      }
    }
    this.results.set(command.commandId, result!); return result!;
  }
}

export const exercisePreparationService = new ExercisePreparationService({ snapshot: getCanonicalExerciseSnapshot, activePackage: () => activeExercisePackageService.getActive(), compatibility: pkg => exercisePackageValidator.compatibility(pkg), bind: (id, pkg) => exercisePackageLoader.bind(id, pkg), unbind: id => exercisePackageLoader.unbind(id), reset: command => executeExerciseReset(command, { notify: false }), capture: captureCompleted, archive: storeCompletedExerciseArchive, plan: (id, pkg) => createPatientMaterializationPlan(id, pkg, packagePatientDatasetRegistry), install: installPatientMaterialization, clear: clearPreparedExerciseWorkingData, publish: () => notifySync("local") });
