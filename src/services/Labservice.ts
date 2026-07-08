import { setLabVisibility } from "@/repositories/LabRepository";

export function openLabPanel(
  patientId: string,
  panel: string
): void {
  setLabVisibility(
    patientId,
    panel,
    "revealed"
  );
}