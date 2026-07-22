import type { VitalSigns } from "@/models/VitalSigns";
import { clinicalDataProvider } from "@/providers/ProviderFactory";
import { getExerciseSession } from "@/repositories/ExerciseSessionRepository";

export function getVitalSigns(patientId: string): VitalSigns[] {
  const currentMinute = getExerciseSession().currentMinute;
  return clinicalDataProvider
    .getVitalSigns()
    .filter(
      (measurement) =>
        measurement.patientId === patientId &&
        measurement.exerciseMinute <= currentMinute
    )
    .sort((a, b) =>
      b.exerciseMinute - a.exerciseMinute ||
      (b.recordedAt ?? "").localeCompare(a.recordedAt ?? "")
    );
}

export function addVitalSigns(measurement: VitalSigns): void {
  clinicalDataProvider.getVitalSigns().push(measurement);
}

export function resetVitalSigns(): void {
  clinicalDataProvider.resetVitalSigns();
}
