import type { GoldenFixture } from "@/models/GoldenTest";
import type { HemorrhageConfiguration, PelvicSourceControlConfiguration } from "@/models/HemorrhagePatientProcess";
import type { PackagePatientDataset } from "@/models/exercise/PackagePatientDataset";
import { getRegisteredImagingAsset } from "@/services/imaging/ImagingAssetRegistry";
import { deepFreeze } from "@/utils/immutable";
import { createExercisePackage } from "./ExercisePackageHash";
import { NARVA_PELVIC_FIXTURE, NARVA_TRAUMA_MTP_CONFIGURATION,
  NARVA_TRAUMA_OUTDOOR_PATIENT_DATASET } from "./NarvaPatientDatasets";
import { NARVA_TRAUMA_EXERCISE_PACKAGE_V107 } from "./NarvaTraumaImagingV107";

/** Approved simulation calibration; operational release still requires device acceptance. */
export const NARVA_PELVIC_V108_SOURCE_CONTROL = deepFreeze({
  openRateMlMin: 140, incorrectRateMlMin: 60, loosenedRateMlMin: 50,
  correctMaturation: [
    { afterSec: 0, rateMlMin: 20 }, { afterSec: 1800, rateMlMin: 12 },
    { afterSec: 5400, rateMlMin: 8 }, { afterSec: 10800, rateMlMin: 6 },
  ],
} satisfies PelvicSourceControlConfiguration);

const priorInitial = structuredClone(NARVA_PELVIC_FIXTURE.initialState) as Record<string, unknown>;
const priorSources = priorInitial.hemorrhageSources as readonly Readonly<Record<string, unknown>>[];

export const NARVA_PELVIC_V108_FIXTURE: GoldenFixture = deepFreeze({
  ...structuredClone(NARVA_PELVIC_FIXTURE),
  fixtureId: "FX-NARVA-PELVIC-1.0.8",
  initialState: {
    ...priorInitial,
    // Reuse the existing opt-in model: bad perfusion may lower GCS or become terminal.
    // No monitor override, forced outcome or change to the shared engine is introduced.
    physiologicDecompensationEnabled: true,
    hemorrhageSources: priorSources.map(source => ({ ...source,
      configuration: { ...structuredClone(source.configuration as HemorrhageConfiguration),
        pelvicSourceControl: NARVA_PELVIC_V108_SOURCE_CONTROL },
    })),
    massiveTransfusion: { ...(priorInitial.massiveTransfusion as Record<string, unknown>), configuration: {
      ...structuredClone(NARVA_TRAUMA_MTP_CONFIGURATION),
      // Authored finite simulation stock, not confirmed clinical stock or a dosing protocol.
      initialInventory: { RBC: 8, PLASMA: 8, PLATELETS: 0 },
    } },
  },
});

export const NARVA_TRAUMA_PELVIC_V108_DATASET: PackagePatientDataset = deepFreeze({
  datasetId: "patients.narva-trauma.v4", version: "4",
  patients: NARVA_TRAUMA_OUTDOOR_PATIENT_DATASET.patients.map(record => ({ ...structuredClone(record),
    ...(record.patient.id === "PT-PELVIC-001" ? { runtimeFixture: NARVA_PELVIC_V108_FIXTURE } : {}),
  })),
});

const retainedAssets: Record<string, string> = {
  "P01-CXR": "russicaptor.narva-trauma.p01-cxr.normal-chest-pa.v2",
  "P01-PELVIS-XR": "russicaptor.narva-trauma.p01-pelvis-xr.pelvis-illustration.v3",
  "P02-CXR": "russicaptor.narva-trauma.p02-cxr.chest-pneumothorax.v3",
  "P02-PELVIS-XR": "russicaptor.narva-trauma.p02-pelvis-xr.normal-adult-male-pelvis.v2",
};

export const NARVA_TRAUMA_EXERCISE_PACKAGE_V108 = createExercisePackage({
  ...NARVA_TRAUMA_EXERCISE_PACKAGE_V107,
  packageVersion: "1.0.8",
  patientDatasetId: NARVA_TRAUMA_PELVIC_V108_DATASET.datasetId,
  imagingConfiguration: { schemaVersion: 1,
    definitions: NARVA_TRAUMA_EXERCISE_PACKAGE_V107.imagingConfiguration!.definitions.map(definition => {
      const asset = getRegisteredImagingAsset(retainedAssets[definition.study.id]);
      if (!asset) throw new Error(`NARVA_IMAGING_ASSET_MISSING:${definition.study.id}`);
      return { ...definition, study: { ...definition.study, asset } };
    }),
  },
  metadata: { ...NARVA_TRAUMA_EXERCISE_PACKAGE_V107.metadata,
    description: "Kohalik vaagnapatsiendi kalibratsiooni kandidaat: astmeline lahaseefekt, piiratud veretoodete varu ja olemasolev dekompensatsioonimudel. Ei ole operatiivseks kasutuseks väljastatud ega kliiniliselt valideeritud.",
    tags: [...NARVA_TRAUMA_EXERCISE_PACKAGE_V107.metadata.tags, "pelvic-calibration-v108", "local-candidate"],
  },
});
