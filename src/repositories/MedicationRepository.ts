import type {
  MedicationAdministration,
  MedicationOption,
} from "@/models/Medication";
import { clinicalDataProvider } from "@/providers/ProviderFactory";

export function getMedicationOptions(patientId: string): MedicationOption[] {
  return clinicalDataProvider
    .getMedicationOptions()
    .filter(
      (option) =>
        option.patientId === patientId && option.visibility !== "hidden"
    );
}

export function getMedicationOption(
  patientId: string,
  optionId: string
): MedicationOption | undefined {
  return getMedicationOptions(patientId).find((option) => option.id === optionId);
}

export function getMedicationAdministrations(
  patientId: string
): MedicationAdministration[] {
  return clinicalDataProvider
    .getMedicationAdministrations()
    .filter((item) => item.patientId === patientId)
    .sort((a, b) => b.administeredAt.localeCompare(a.administeredAt));
}

export function addMedicationAdministration(
  administration: MedicationAdministration
): void {
  clinicalDataProvider.getMedicationAdministrations().push(administration);
}

export function resetMedicationAdministrations(): void {
  clinicalDataProvider.resetMedicationAdministrations();
}
