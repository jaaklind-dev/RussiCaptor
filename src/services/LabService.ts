import { setLabVisibility } from "@/repositories/LabRepository";
import { logLabPanelViewed } from "@/repositories/TimelineRepository";
import { notifySync } from "@/services/SyncService";
import { canCurrentCaseManagerEditPatient } from "@/services/AssignmentRepository";

export function openLabPanel(
  patientId: string,
  panel: string
): void {
  if (!canCurrentCaseManagerEditPatient(patientId)) {
    return;
  }

  setLabVisibility(patientId, panel, "revealed");

  logLabPanelViewed(patientId, panel);

  notifySync();
}
