import { setLabVisibility } from "@/repositories/LabRepository";
import { logLabPanelViewed } from "@/repositories/TimelineRepository";
import { notifySync } from "@/services/SyncService";

export function openLabPanel(
  patientId: string,
  panel: string
): void {
  setLabVisibility(patientId, panel, "revealed");

  logLabPanelViewed(patientId, panel);

  notifySync();
}