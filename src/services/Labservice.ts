import { setLabVisibility } from "@/repositories/LabRepository";
import { logLabPanelViewed } from "@/repositories/TimelineRepository";

export function openLabPanel(
  patientId: string,
  panel: string
): void {
  setLabVisibility(
    patientId,
    panel,
    "revealed"
  );

  logLabPanelViewed(
    patientId,
    panel
  );
}