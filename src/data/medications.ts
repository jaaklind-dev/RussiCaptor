import type {
  MedicationAdministration,
  MedicationOption,
} from "@/models/Medication";

export const medicationOptions: MedicationOption[] = [
  {
    id: "MEDOPT-001",
    exerciseId: "demo",
    patientId: "PT-001",
    name: "Botulismi antitoksiin",
    dose: "1 viaal",
    route: "IV",
    visibility: "available",
  },
  {
    id: "MEDOPT-002",
    exerciseId: "demo",
    patientId: "PT-001",
    name: "NaCl 0,9%",
    dose: "500 ml",
    route: "IV",
    visibility: "available",
  },
];

export const medicationAdministrations: MedicationAdministration[] = [];
