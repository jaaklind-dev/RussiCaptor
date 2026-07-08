import { LabResult } from "@/models/LabResult";
import { labs } from "@/data/labs";

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