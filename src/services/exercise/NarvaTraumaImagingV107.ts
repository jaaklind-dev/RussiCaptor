import type { PackageImagingConfiguration } from "@/models/exercise/PackageImagingConfiguration";
import { getRegisteredImagingAsset } from "@/services/imaging/ImagingAssetRegistry";
import { deepFreeze } from "@/utils/immutable";
import { createExercisePackage } from "./ExercisePackageHash";
import { NARVA_TRAUMA_EXERCISE_PACKAGE_V106 } from "./NarvaTraumaImagingV106";

/** Optional cross-region studies; no study is ordered merely by loading this package. */
export const NARVA_TRAUMA_IMAGING_V107_NORMAL_REPORTS = deepFreeze({
  chest: "PA-rindkere ülesvõte. Kopsuväljad on selged. Pleuraefusiooni ega pneumotooraksit ei ilmne. "
    + "Südame vari ei ole laienenud.",
  pelvis: "Vaagna ülesvõttel ägeda luumurru ega nihestuse tunnuseid ei ilmne. "
    + "Vaagnarõngas on terviklik, häbemeliidus ei ole laienenud.",
});

function asset(assetId: string) {
  const registered = getRegisteredImagingAsset(assetId);
  if (!registered) throw new Error(`NARVA_IMAGING_ASSET_MISSING:${assetId}`);
  return registered;
}

// Asset metadata is immutable and package-version-bound. These additional registrations
// retain the exact 1.0.6 pathological image bytes/provenance without changing old references.
const retainedAssetIds: Record<string, string> = {
  "P02-CXR": "russicaptor.narva-trauma.p02-cxr.chest-pneumothorax.v2",
  "P01-PELVIS-XR": "russicaptor.narva-trauma.p01-pelvis-xr.pelvis-illustration.v2",
};

export const NARVA_TRAUMA_IMAGING_V107_CONFIGURATION = deepFreeze({
  schemaVersion: 1,
  definitions: [
    ...NARVA_TRAUMA_EXERCISE_PACKAGE_V106.imagingConfiguration!.definitions.map(definition => ({
      ...definition,
      study: { ...definition.study, asset: asset(retainedAssetIds[definition.study.id]) },
    })),
    {
      study: {
        id: "P01-CXR", patientId: "PT-PELVIC-001", modality: "XR",
        title: "Rindkere röntgen", report: NARVA_TRAUMA_IMAGING_V107_NORMAL_REPORTS.chest,
        asset: asset("russicaptor.narva-trauma.p01-cxr.normal-chest-pa.v1"),
        status: "processing", imageVisibility: "hidden", reportVisibility: "hidden",
      },
      order: {
        id: "P01-ORD-CXR", title: "Rindkere röntgen", status: "available", visibility: "revealed",
        workflow: {
          resultAction: "imaging.available", resultTargetId: "P01-CXR", imageDelayMinutes: 7, delayMinutes: 10,
          resultTitle: "Rindkere röntgen valmis", resultDescription: "Uuringu vastus on kättesaadav.",
        },
      },
    },
    {
      study: {
        id: "P02-PELVIS-XR", patientId: "PT-CHEST-001", modality: "XR",
        title: "Vaagna röntgen", report: NARVA_TRAUMA_IMAGING_V107_NORMAL_REPORTS.pelvis,
        asset: asset("russicaptor.narva-trauma.p02-pelvis-xr.normal-adult-male-pelvis.v1"),
        status: "processing", imageVisibility: "hidden", reportVisibility: "hidden",
      },
      order: {
        id: "P02-ORD-PELVIS-XR", title: "Vaagna röntgen", status: "available", visibility: "revealed",
        workflow: {
          resultAction: "imaging.available", resultTargetId: "P02-PELVIS-XR", imageDelayMinutes: 7, delayMinutes: 10,
          resultTitle: "Vaagna röntgen valmis", resultDescription: "Uuringu vastus on kättesaadav.",
        },
      },
    },
  ],
} satisfies PackageImagingConfiguration);

export const NARVA_TRAUMA_EXERCISE_PACKAGE_V107 = createExercisePackage({
  ...NARVA_TRAUMA_EXERCISE_PACKAGE_V106,
  packageVersion: "1.0.7",
  imagingConfiguration: NARVA_TRAUMA_IMAGING_V107_CONFIGURATION,
  metadata: {
    ...NARVA_TRAUMA_EXERCISE_PACKAGE_V106.metadata,
    description: "Narva kahe patsiendi traumaõppus seniste patoloogiliste ning valikuliselt tellitavate normaalsete rindkere- ja vaagnaröntgenitega.",
    tags: [...NARVA_TRAUMA_EXERCISE_PACKAGE_V106.metadata.tags, "authored-imaging-v107", "optional-normal-radiographs"],
  },
});
