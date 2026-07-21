import type { Visibility } from "@/models/Visibility";

export type MedicationOption = {
  id: string;
  exerciseId: string;
  patientId: string;
  name: string;
  dose: string;
  route: string;
  visibility: Visibility;
};

export type MedicationAdministration = {
  id: string;
  exerciseId: string;
  patientId: string;
  medicationOptionId: string;
  name: string;
  dose: string;
  route: string;
  administeredBy: string;
  administeredAt: string;
};
