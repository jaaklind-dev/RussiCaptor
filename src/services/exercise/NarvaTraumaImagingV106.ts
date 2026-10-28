import type { PackageImagingConfiguration } from "@/models/exercise/PackageImagingConfiguration";
import { getRegisteredImagingAsset } from "@/services/imaging/ImagingAssetRegistry";
import { deepFreeze } from "@/utils/immutable";
import { createExercisePackage } from "./ExercisePackageHash";
import { NARVA_TRAUMA_EXERCISE_PACKAGE } from "./NarvaExercisePackages";

/** Explicit 2026-10-28 content extension; published 1.0.1–1.0.5 remain unchanged. */
export const NARVA_TRAUMA_IMAGING_V106_REPORTS = deepFreeze({
  chest: "Leid sobib pingelise õhkrinnaga. Kaasuvad pneumomediastiinum ja roidemurrud. "
    + "Hemotooraksit ega verekaotuse suurust selle pildi põhjal ei kinnitata.",
  pelvis: "Häbemeliidus on laienenud. Leid sobib avatud raamatu tüüpi vaagnarõnga vigastusega. "
    + "Verekaotuse suurust pildi põhjal ei hinnata.",
});

function asset(assetId: string) {
  const registered = getRegisteredImagingAsset(assetId);
  if (!registered) throw new Error(`NARVA_IMAGING_ASSET_MISSING:${assetId}`);
  return registered;
}

export const NARVA_TRAUMA_IMAGING_V106_CONFIGURATION = deepFreeze({
  schemaVersion: 1,
  definitions: [
    {
      study: {
        id: "P02-CXR", patientId: "PT-CHEST-001", modality: "XR",
        title: "Rindkere röntgen", report: NARVA_TRAUMA_IMAGING_V106_REPORTS.chest,
        asset: asset("russicaptor.narva-trauma.p02-cxr.chest-pneumothorax.v1"),
        status: "processing", imageVisibility: "hidden", reportVisibility: "hidden",
      },
      order: {
        id: "P02-ORD-CXR", title: "Rindkere röntgen", status: "available", visibility: "revealed",
        workflow: {
          resultAction: "imaging.available", resultTargetId: "P02-CXR", imageDelayMinutes: 7, delayMinutes: 10,
          resultTitle: "Rindkere röntgen valmis", resultDescription: "Uuringu vastus on kättesaadav.",
        },
      },
    },
    {
      study: {
        id: "P01-PELVIS-XR", patientId: "PT-PELVIC-001", modality: "XR",
        title: "Vaagna röntgen", report: NARVA_TRAUMA_IMAGING_V106_REPORTS.pelvis,
        asset: asset("russicaptor.narva-trauma.p01-pelvis-xr.pelvis-illustration.v1"),
        status: "processing", imageVisibility: "hidden", reportVisibility: "hidden",
      },
      order: {
        id: "P01-ORD-PELVIS-XR", title: "Vaagna röntgen", status: "available", visibility: "revealed",
        workflow: {
          resultAction: "imaging.available", resultTargetId: "P01-PELVIS-XR",
          // User-approved staged simulation timing; both deadlines are measured from order.
          imageDelayMinutes: 7, delayMinutes: 10,
          resultTitle: "Vaagna röntgen valmis", resultDescription: "Uuringu vastus on kättesaadav.",
        },
      },
    },
  ],
} satisfies PackageImagingConfiguration);

export const NARVA_TRAUMA_EXERCISE_PACKAGE_V106 = createExercisePackage({
  ...NARVA_TRAUMA_EXERCISE_PACKAGE,
  packageVersion: "1.0.6",
  imagingConfiguration: NARVA_TRAUMA_IMAGING_V106_CONFIGURATION,
  metadata: {
    ...NARVA_TRAUMA_EXERCISE_PACKAGE.metadata,
    description: "Narva kahe patsiendi traumaõppus rindkere õppepildi ja genereeritud vaagnaillustratsiooniga.",
    tags: [...NARVA_TRAUMA_EXERCISE_PACKAGE.metadata.tags, "authored-imaging-v106", "educational-images"],
  },
});
