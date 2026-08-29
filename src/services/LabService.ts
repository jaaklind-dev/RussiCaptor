import { setLabVisibility } from "@/repositories/LabRepository";
import { logLabPanelViewed } from "@/repositories/TimelineRepository";
import { notifySync } from "@/services/SyncService";
import { canCurrentCaseManagerEditPatient } from "@/services/AssignmentRepository";
import { createId } from "@/utils/id";
import { executeAuthoritativePatientMutation } from "@/services/sharedWorkflow/AuthoritativePatientMutationService";

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

export function openLabPanelConflictSafe(patientId:string,panel:string){
  return executeAuthoritativePatientMutation({patientId,commandId:createId("SW-LAB"),kind:"MUTABLE",mutate:()=>openLabPanel(patientId,panel)});
}
