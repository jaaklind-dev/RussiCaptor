import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import type { MaterializedPatientDataset } from "@/models/exercise/PackagePatientDataset";
import { clinicalDataProvider } from "@/providers/ProviderFactory";

export function installPackageQuestions(plan: MaterializedPatientDataset, pkg: ExercisePackage): void {
  if (!pkg.questionConfiguration) return;
  const patientIds = new Set(plan.patients.map(item => item.patient.id));
  const target = clinicalDataProvider.getQuestions();
  const installed = (pkg.questionConfiguration?.definitions ?? [])
    .filter(item => patientIds.has(item.patientId))
    .map(item => ({ id: item.questionId, exerciseId: plan.exerciseId, patientId: item.patientId,
      category: item.category, prompt: item.prompt, answer: item.answer, visibility: item.visibility,
      order: item.order, packageId: pkg.packageId, packageVersion: pkg.packageVersion,
      sourcePatientId: item.sourcePatientId }))
    .sort((left, right) => left.patientId.localeCompare(right.patientId) || left.order - right.order ||
      left.id.localeCompare(right.id));
  target.splice(0, target.length, ...target.filter(item => !patientIds.has(item.patientId)), ...installed);
}
