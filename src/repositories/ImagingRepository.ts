import { imagingStudies } from "@/data/imaging";
import { ImagingStudy } from "@/models/ImagingStudy";

export function getImagingStudies(patientId: string): ImagingStudy[] {
  return imagingStudies.filter((study) => study.patientId === patientId);
}

export function setImagingImageVisibility(
  patientId: string,
  imagingId: string,
  visibility: ImagingStudy["imageVisibility"]
): void {
  const study = imagingStudies.find(
    (study) => study.patientId === patientId && study.id === imagingId
  );

  if (study) {
    study.imageVisibility = visibility;
  }
}

export function setImagingReportVisibility(
  patientId: string,
  imagingId: string,
  visibility: ImagingStudy["reportVisibility"]
): void {
  const study = imagingStudies.find(
    (study) => study.patientId === patientId && study.id === imagingId
  );

  if (study) {
    study.reportVisibility = visibility;
  }
}