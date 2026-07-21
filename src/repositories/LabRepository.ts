import { LabResult } from "@/models/LabResult";
import { clinicalDataProvider } from "@/providers/ProviderFactory";

export function getLabResults(
  patientId: string
): LabResult[] {
  return clinicalDataProvider.getLabs()
    .filter((lab) => lab.patientId === patientId)
    .sort((a, b) => {
      if (a.panel !== b.panel) {
        return a.panel.localeCompare(b.panel);
      }

      return a.name.localeCompare(b.name);
    });
}

export function getLabPanel(
  patientId: string,
  panel: string
): LabResult[] {
  return clinicalDataProvider.getLabs().filter(
    (lab) =>
      lab.patientId === patientId &&
      lab.panel === panel
  );
}

export function setLabVisibility(
  patientId: string,
  panel: string,
  visibility: LabResult["visibility"]
): void {
  clinicalDataProvider.getLabs()
    .filter(
      (lab) =>
        lab.patientId === patientId &&
        lab.panel === panel
    )
    .forEach((lab) => {
      lab.visibility = visibility;
    });
}

export function setLabPanelStatus(
  patientId: string,
  panel: string,
  status: LabResult["status"]
): void {
  getLabPanel(patientId, panel).forEach((lab) => {
    lab.status = status;
  });
}

export function resetLabResults(): void {
  clinicalDataProvider.resetLabs();
}
