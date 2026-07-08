import { ImagingStudy } from "@/models/ImagingStudy";
import { imagingStudies } from "@/data/imaging";

export function getImagingStudies(
  patientId: string
): ImagingStudy[] {
  return imagingStudies.filter(
    (study) => study.patientId === patientId
  );
}

export function setImagingVisibility(
  patientId: string,
  imagingId: string,
  visibility: ImagingStudy["visibility"]
): void {
  const study = imagingStudies.find(
    (study) =>
      study.patientId === patientId &&
      study.id === imagingId
  );

  if (study) {
    study.visibility = visibility;
  }
}