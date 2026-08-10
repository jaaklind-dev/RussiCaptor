import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getAllPatients } from "@/repositories/PatientRepository";
import { getExerciseTimelineSnapshot, getExerciseTimelineVersion, subscribeToExerciseTimeline } from "./ExerciseTimelineService";
import { getCanonicalPatientRuntimeSnapshot, getRuntimeSnapshotVersion, subscribeToRuntimeSnapshots } from "./RuntimeSnapshotService";
import { reconstructDebrief } from "./debrief/DebriefEngine";
import { getExercisePackage } from "./exercise/ExercisePackageService";

let cacheKey = "";
let cached: ReturnType<typeof reconstructDebrief> | undefined;

export function getDebriefReport() {
  const exercise = getCanonicalExerciseSnapshot();
  const key = `${exercise.version}:${exercise.simulationTimeSec}:${getExerciseTimelineVersion()}:${getRuntimeSnapshotVersion()}`;
  if (cached && key === cacheKey) return cached;
  const currentExercise = getCurrentExercise();
  cached = reconstructDebrief({ exercise, protocolProvenance: getExercisePackage(exercise.exerciseId).definition.protocolProvenance,
    timeline: getExerciseTimelineSnapshot(), patients: getAllPatients().map(patient => ({
    patient, runtime: getCanonicalPatientRuntimeSnapshot(patient.id),
  })) });
  if (cached.exerciseId !== currentExercise.id) throw new Error("Debrief source exercise mismatch");
  cacheKey = key;
  return cached;
}

export function getDebriefVersion(): string { return `${getExerciseTimelineVersion()}:${getRuntimeSnapshotVersion()}:${getCanonicalExerciseSnapshot().version}:${getCanonicalExerciseSnapshot().simulationTimeSec}`; }
export function subscribeToDebrief(listener: () => void): () => void {
  const timeline = subscribeToExerciseTimeline(listener); const runtime = subscribeToRuntimeSnapshots(listener);
  return () => { timeline(); runtime(); };
}
