import { Exercise } from "@/models/Exercise";
import { DEFAULT_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import { exercisePackageLoader } from "@/services/exercise/ExercisePackageService";

const currentExercise: Exercise = {

  id: "demo",

  name: "Demo Exercise",

  description: "Development exercise",

  startTime: "2026-07-08T09:00:00",

  status: "running",

};

export function getCurrentExercise(): Exercise {

  return currentExercise;

}

export function installCurrentExercise(id: string, name: string, exercisePackage?: ExercisePackage): void {
  const selectedPackage = exercisePackage ?? exercisePackageLoader.getBound(id) ?? DEFAULT_EXERCISE_PACKAGE;
  currentExercise.id = id;
  currentExercise.name = name === id ? selectedPackage.metadata.name : name;
  currentExercise.description = "Excelist imporditud harjutus";
  currentExercise.status = "draft";
  if (exercisePackage) exercisePackageLoader.unbind(id);
  if (!exercisePackageLoader.getBound(id)) exercisePackageLoader.bind(id, selectedPackage);
}
