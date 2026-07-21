import type { InterventionOption } from "@/models/Intervention";

export const interventionOptions: InterventionOption[] = [
  {
    id: "INTOPT-001",
    exerciseId: "demo",
    patientId: "PT-001",
    type: "airway",
    label: "Hingamistee tagamine",
    visibility: "available",
  },
  {
    id: "INTOPT-002",
    exerciseId: "demo",
    patientId: "PT-001",
    type: "iv_access",
    label: "Veenitee rajamine",
    visibility: "available",
  },
];
