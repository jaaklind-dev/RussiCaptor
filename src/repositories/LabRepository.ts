import { LabResult } from "@/models/LabResult";
import { labs } from "@/data/labs";

const initialLabs = labs.map((lab) => ({ ...lab }));

export function getLabResults(
  patientId: string
): LabResult[] {
  return labs
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
  return labs.filter(
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
  labs
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
  labs.splice(
    0,
    labs.length,
    ...initialLabs.map((lab) => ({ ...lab }))
  );
}
