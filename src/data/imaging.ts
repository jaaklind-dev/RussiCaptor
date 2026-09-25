import { ImagingStudy } from "@/models/ImagingStudy";
import { DEMO_HEAD_CT_ASSET } from "@/services/imaging/ImagingAssetRegistry";

export const imagingStudies: ImagingStudy[] = [
  {

  id: "IMG-001",

  exerciseId: "demo",

  patientId: "PT-001",

  modality: "CT",

  title: "KT pea",

  report: "Ägeda intrakraniaalse verejooksu tunnuseid ei ole. Massiefekti ei ole. Basaaltsisternid on vabad.",

asset: DEMO_HEAD_CT_ASSET,

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
