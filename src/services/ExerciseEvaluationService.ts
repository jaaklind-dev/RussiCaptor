import { getAnalyticsReport } from "./AnalyticsService";
import { getProtocolAssessmentReport, getProtocolAssessmentVersion, subscribeToProtocolAssessment } from "./ProtocolAssessmentService";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { getExercisePackage } from "./exercise/ExercisePackageService";
import { exerciseEvaluationProfileRegistry } from "./evaluation/ExerciseEvaluationProfileService";
import { evaluateExercise } from "./evaluation/ExerciseEvaluationEngine";
import type { ExerciseEvaluationResult } from "@/models/evaluation/ExerciseEvaluation";

let version = ""; let cached: ExerciseEvaluationResult | undefined;
export function getExerciseEvaluationResult(): ExerciseEvaluationResult | undefined {
  const assessment = getProtocolAssessmentReport(); const pkg = getExercisePackage(getCurrentExercise().id); const reference = pkg.evaluationProfile;
  if (!assessment || !reference) { cached = undefined; version = ""; return undefined; }
  const next = `${getProtocolAssessmentVersion()}:${reference.profileId}@${reference.version}:${getAnalyticsReport().analyticsHash}`;
  if (!cached || version !== next) { cached = evaluateExercise(exerciseEvaluationProfileRegistry.require(reference), assessment, getAnalyticsReport()); version = next; }
  return cached;
}
export const getExerciseEvaluationVersion = () => `${getProtocolAssessmentVersion()}:${getExerciseEvaluationResult()?.evaluationHash ?? "NONE"}`;
export const subscribeToExerciseEvaluation = subscribeToProtocolAssessment;
