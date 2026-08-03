import type { InstructorPatientCardModel } from "@/models/InstructorDashboard";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import type { ExerciseLifecycleState, CanonicalExerciseSpeed } from "@/models/exercise/CanonicalExerciseSnapshot";
import { getAllPatients } from "@/repositories/PatientRepository";
import { getPatientAssignment } from "@/services/AssignmentRepository";
import {
  getRuntimeSnapshots, getRuntimeSnapshotVersion, subscribeToRuntimeSnapshots,
} from "@/services/RuntimeSnapshotService";
import { getSyncVersion, subscribeToSync } from "@/services/SyncService";
import { projectInstructorPatients } from "@/services/runtime/selectors/InstructorDashboardSelector";

export type InstructorDashboardSnapshot = {
  readonly exerciseName: string;
  readonly exerciseTimeSec: number;
  readonly exerciseState: ExerciseLifecycleState;
  readonly exerciseSpeed: CanonicalExerciseSpeed;
  readonly exerciseVersion: number;
  readonly patients: readonly InstructorPatientCardModel[];
};

let cachedVersion = "";
let cachedSnapshot: InstructorDashboardSnapshot | undefined;

/** Read-only presentation adapter. It performs no runtime writes or clinical calculations. */
export function getInstructorDashboardSnapshot(): InstructorDashboardSnapshot {
  const version = getInstructorDashboardVersion();
  if (cachedSnapshot && cachedVersion === version) return cachedSnapshot;
  const session = getCanonicalExerciseSnapshot();
  const runtimeStates = getRuntimeSnapshots();
  cachedSnapshot = {
    exerciseName: getCurrentExercise().name,
    exerciseTimeSec: session.simulationTimeSec,
    exerciseState: session.lifecycleState,
    exerciseSpeed: session.speed,
    exerciseVersion: session.version,
    patients: projectInstructorPatients(
      getAllPatients().map(patient => ({ ...patient, assignment: getPatientAssignment(patient.id) })),
      runtimeStates
    ),
  };
  cachedVersion = version;
  return cachedSnapshot;
}

export function getInstructorDashboardVersion(): string {
  return `${getRuntimeSnapshotVersion()}:${getSyncVersion()}`;
}

export function subscribeToInstructorDashboard(listener: () => void): () => void {
  const stopRuntime = subscribeToRuntimeSnapshots(listener);
  const stopMetadata = subscribeToSync(listener);
  return () => { stopRuntime(); stopMetadata(); };
}
