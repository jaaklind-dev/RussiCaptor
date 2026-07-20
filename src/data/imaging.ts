import { ImagingStudy } from "@/models/ImagingStudy";

export const imagingStudies: ImagingStudy[] = [
  {

  id: "IMG-001",

  exerciseId: "demo",

  patientId: "PT-001",

  modality: "CT",

  title: "KT pea",

  report: "Ägeda intrakraniaalse verejooksu tunnuseid ei ole. Massiefekti ei ole. Basaaltsisternid on vabad.",

attachment: "image01.jpg",

  status: "processing",

  imageVisibility: "hidden",
reportVisibility: "hidden",

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
    imageVisibility: "hidden",
reportVisibility: "hidden",
  },
];
