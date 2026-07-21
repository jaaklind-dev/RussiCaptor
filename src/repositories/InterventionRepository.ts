import type { Intervention } from "@/models/Intervention";
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

export function resetInterventions(): void {
  clinicalDataProvider.resetInterventions();
}
