import { ImagingStudy } from "@/models/ImagingStudy";

export const imagingStudies: ImagingStudy[] = [
  {
    id: "IMG-001",
    exerciseId: "demo",
    patientId: "PT-001",

    modality: "CT",
    title: "CT Head",

    report:
      "No acute intracranial haemorrhage. No mass effect. Basal cisterns preserved.",

    status: "available",
    visibility: "hidden",

    releasedAt: "09:45",
  },

  {
    id: "IMG-002",
    exerciseId: "demo",
    patientId: "PT-001",

    modality: "XR",
    title: "Chest X-ray",

    report:
      "No focal infiltrates. Cardiomediastinal silhouette within normal limits.",

    status: "processing",
    visibility: "hidden",
  },
];