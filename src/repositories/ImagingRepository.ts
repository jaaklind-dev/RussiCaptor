import { ImagingStudy } from "@/models/ImagingStudy";
import { clinicalDataProvider } from "@/providers/ProviderFactory";

export function getImagingStudies(patientId: string): ImagingStudy[] {
  return clinicalDataProvider
    .getImagingStudies()
    .filter((study) => study.patientId === patientId);
}

export function setImagingImageVisibility(
  patientId: string,
  imagingId: string,
  visibility: ImagingStudy["imageVisibility"]
): void {
  const study = clinicalDataProvider.getImagingStudies().find(
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
  const study = clinicalDataProvider.getImagingStudies().find(
    (study) => study.patientId === patientId && study.id === imagingId
  );

  if (study) {
    study.reportVisibility = visibility;
  }
}
export function setImagingStatus(
  patientId: string,
  imagingId: string,
  status: ImagingStudy["status"]
): void {
  const study = clinicalDataProvider.getImagingStudies().find(
    (study) =>
      study.patientId === patientId &&
      study.id === imagingId
  );

  if (study) {
    study.status = status;
  }
}

export function resetImagingStudies(): void {
  clinicalDataProvider.resetImagingStudies();
}
