import type { Intervention, InterventionOption } from "@/models/Intervention";
import { clinicalDataProvider } from "@/providers/ProviderFactory";

export function getInterventions(patientId: string): Intervention[] {
  return clinicalDataProvider
    .getInterventions()
    .filter((intervention) => intervention.patientId === patientId)
    .sort((a, b) => b.performedAt.localeCompare(a.performedAt));
}

export function addIntervention(intervention: Intervention): void {
  clinicalDataProvider.getInterventions().push(intervention);
}

export function getInterventionOptions(patientId: string): InterventionOption[] {
  return clinicalDataProvider
    .getInterventionOptions()
    .filter(
      (option) =>
        option.patientId === patientId && option.visibility !== "hidden"
    );
}

export function getInterventionOption(
  patientId: string,
  optionId: string
): InterventionOption | undefined {
  return getInterventionOptions(patientId).find((option) => option.id === optionId);
}

export function resetInterventions(): void {
  clinicalDataProvider.resetInterventions();
}
