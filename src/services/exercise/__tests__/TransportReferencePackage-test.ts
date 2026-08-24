import { TRANSPORT_REFERENCE_EXERCISE_PACKAGE, HISTORICAL_BOTULISM_EXERCISE_PACKAGE_V1, PLEURAL_INJURY_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { exercisePackageRegistry, exercisePackageValidator } from "@/services/exercise/ExercisePackageService";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { createExercisePackage } from "@/services/exercise/ExercisePackageHash";

describe("WP-45C transport package configuration", () => {
  test("reference package and its two patients are generically registered", () => { expect(exercisePackageRegistry.get("russicaptor.transport-reference", "1.0.0")).toEqual(TRANSPORT_REFERENCE_EXERCISE_PACKAGE); const dataset=packagePatientDatasetRegistry.resolve("patients.transport-reference.v1"); expect(dataset.patients.map(x=>x.patient.id)).toEqual(["PT-TRANSPORT-01","PT-TRANSPORT-02"]); expect(TRANSPORT_REFERENCE_EXERCISE_PACKAGE.transportConfiguration?.resources[0].resourceId).toBe("REANIMOBILE-01"); });
  test("transport content participates in immutable package hash", () => { const changed=createExercisePackage({ ...structuredClone(TRANSPORT_REFERENCE_EXERCISE_PACKAGE), packageHash: undefined as never, manifest: undefined as never, transportConfiguration: { ...structuredClone(TRANSPORT_REFERENCE_EXERCISE_PACKAGE.transportConfiguration!), destinations: TRANSPORT_REFERENCE_EXERCISE_PACKAGE.transportConfiguration!.destinations.map((x,i)=>i?x:{...x,travelDurationSec:x.travelDurationSec+1}) } } as never); expect(changed.packageHash).not.toBe(TRANSPORT_REFERENCE_EXERCISE_PACKAGE.packageHash); });
  test("historical packages without transport configuration remain valid", () => { expect(exercisePackageValidator.validate(HISTORICAL_BOTULISM_EXERCISE_PACKAGE_V1)).toEqual([]); expect(exercisePackageValidator.validate(PLEURAL_INJURY_EXERCISE_PACKAGE)).toEqual([]); expect(PLEURAL_INJURY_EXERCISE_PACKAGE.transportConfiguration).toBeUndefined(); });
});
