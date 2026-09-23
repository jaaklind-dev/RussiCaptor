import type { PackageImagingConfiguration } from "@/models/exercise/PackageImagingConfiguration";
import { deepFreeze } from "@/utils/immutable";

const report = "Kopsuväljad ilma fokaalse infiltraadita; aspiratsiooni varajasi radioloogilisi tunnuseid ei ole.";

export const BOTULISM_JOHVI_IMAGING_CONFIGURATION = deepFreeze({
  schemaVersion: 1,
  definitions: ["P09", "P11", "P12"].map(patientId => ({
    study: {
      id: `${patientId}-CXR`,
      patientId,
      modality: "XR",
      title: "Rindkere röntgen",
      report,
      status: "processing",
      imageVisibility: "hidden",
      reportVisibility: "hidden",
    },
    order: {
      id: `${patientId}-ORD-CXR`,
      title: "Rindkere röntgen",
      status: "available",
      visibility: "revealed",
      workflow: {
        resultAction: "imaging.available",
        resultTargetId: `${patientId}-CXR`,
        delayMinutes: 7,
        resultTitle: "Rindkere röntgen valmis",
        resultDescription: "Rindkere röntgenuuringu vastus on kättesaadav.",
      },
    },
  })),
} satisfies PackageImagingConfiguration);
