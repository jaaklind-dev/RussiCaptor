import type { PackageImagingConfiguration } from "@/models/exercise/PackageImagingConfiguration";
import { deepFreeze } from "@/utils/immutable";

/** Approved canonical source: Narva workbook P02 / P02-CXR repaired Imaging row. */
export const NARVA_TRAUMA_P02_IMAGING_SOURCE = deepFreeze({
  sourcePatientId: "P02",
  patientId: "PT-CHEST-001",
  studyId: "P02-CXR",
  orderId: "P02-ORD-CXR",
  modality: "XR" as const,
  title: "Rindkere röntgen",
  report: "Massiivsele hemopneumotooraksile sobiv leid.",
  delayMinutes: 7,
  canonicalWorkbookChecksum: "d2618915e91161350783f0d1303fb4117e034e2688285e04850c339b31833231",
});

export const NARVA_TRAUMA_IMAGING_CONFIGURATION = deepFreeze({
  schemaVersion: 1,
  definitions: [{
    study: {
      id: NARVA_TRAUMA_P02_IMAGING_SOURCE.studyId,
      patientId: NARVA_TRAUMA_P02_IMAGING_SOURCE.patientId,
      modality: NARVA_TRAUMA_P02_IMAGING_SOURCE.modality,
      title: NARVA_TRAUMA_P02_IMAGING_SOURCE.title,
      report: NARVA_TRAUMA_P02_IMAGING_SOURCE.report,
      status: "processing",
      imageVisibility: "hidden",
      reportVisibility: "hidden",
    },
    order: {
      id: NARVA_TRAUMA_P02_IMAGING_SOURCE.orderId,
      title: NARVA_TRAUMA_P02_IMAGING_SOURCE.title,
      status: "available",
      visibility: "revealed",
      workflow: {
        resultAction: "imaging.available",
        resultTargetId: NARVA_TRAUMA_P02_IMAGING_SOURCE.studyId,
        delayMinutes: NARVA_TRAUMA_P02_IMAGING_SOURCE.delayMinutes,
        resultTitle: "Rindkere röntgen valmis",
        resultDescription: "Uuringu vastus on kättesaadav.",
      },
    },
  }],
} satisfies PackageImagingConfiguration);
