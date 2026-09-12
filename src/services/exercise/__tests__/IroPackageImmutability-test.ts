import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";
import { calculateExercisePackageHash } from "../ExercisePackageHash";
import { packagePatientDatasetRegistry } from "../CanonicalPatientDatasets";
import { NARVA_IRO_EXERCISE_PACKAGE,
  NARVA_IRO_HISTORICAL_EXERCISE_PACKAGE_V1 } from "../NarvaExercisePackages";
import { createPatientMaterializationPlan } from "../PackagePatientMaterializationService";
import { exercisePackageRegistry, exercisePackageValidator } from "../ExercisePackageService";

const PACKAGE_ID = "russicaptor.narva-iro-evacuation";

describe("WP-NARVA-10B0 immutable IRO package versions", () => {
  test("preserves the exact bf0d76e raw 1.0.0 package identity and canonical hashes", () => {
    expect(NARVA_IRO_HISTORICAL_EXERCISE_PACKAGE_V1).toMatchObject({
      packageId: PACKAGE_ID, packageVersion: "1.0.0",
      patientDatasetId: "patients.narva-iro-evacuation.v1",
      packageHash: "c8838293554026a107e1bbcff6e54d8891fe9f753f88dd115bce2c986073ac78",
      manifest: { definitionHash: "d4ab35758766e91816600315086003d517f0b4a866051d82dd1818e34790530a" },
    });
    expect(calculateExercisePackageHash(NARVA_IRO_HISTORICAL_EXERCISE_PACKAGE_V1))
      .toBe(NARVA_IRO_HISTORICAL_EXERCISE_PACKAGE_V1.packageHash);
  });

  test("publishes the complete clinical content only as 1.0.1 with dataset v2", () => {
    expect(NARVA_IRO_EXERCISE_PACKAGE).toMatchObject({ packageId: PACKAGE_ID,
      packageVersion: "1.0.1", patientDatasetId: "patients.narva-iro-evacuation.v2",
      definition: { definitionVersion: 2 },
      metadata: { tags: expect.arrayContaining(["full-scenario-ready"]) },
      packageHash: "31d8267f61a62ccc3423d4ef15ac8f1f566d4603ab4ae0d55c7f21e7126b5cc4",
      manifest: { definitionHash: "587b1b041131af126af2019550a0c3fcc3be70807d71b7c812d9d097d924b770" },
    });
    expect(calculateExercisePackageHash(NARVA_IRO_EXERCISE_PACKAGE))
      .toBe(NARVA_IRO_EXERCISE_PACKAGE.packageHash);
    expect(NARVA_IRO_EXERCISE_PACKAGE.packageHash)
      .not.toBe(NARVA_IRO_HISTORICAL_EXERCISE_PACKAGE_V1.packageHash);
  });

  test("resolves both exact package and dataset versions without aliasing", () => {
    const historical = exercisePackageRegistry.require(PACKAGE_ID, "1.0.0");
    const current = exercisePackageRegistry.require(PACKAGE_ID, "1.0.1");
    expect(historical.patientDatasetId).toBe("patients.narva-iro-evacuation.v1");
    expect(current.patientDatasetId).toBe("patients.narva-iro-evacuation.v2");
    expect(exercisePackageRegistry.latest(PACKAGE_ID)).toBe(current);
    expect(packagePatientDatasetRegistry.resolve(historical.patientDatasetId).version).toBe("1");
    expect(packagePatientDatasetRegistry.resolve(current.patientDatasetId).version).toBe("2");
    expect(exercisePackageValidator.validate(historical)).toEqual([]);
    expect(exercisePackageValidator.validate(current)).toEqual([]);
  });

  test("materializes each version independently with one unique patient and fixture", () => {
    const historical = exercisePackageRegistry.require(PACKAGE_ID, "1.0.0");
    const current = exercisePackageRegistry.require(PACKAGE_ID, "1.0.1");
    const v1 = createPatientMaterializationPlan("EX-IRO-V1", historical,
      packagePatientDatasetRegistry);
    const v2 = createPatientMaterializationPlan("EX-IRO-V2", current,
      packagePatientDatasetRegistry);
    expect(v1.patients.map(item => item.patient.id)).toEqual(["PT-IRO-001"]);
    expect(v2.patients.map(item => item.patient.id)).toEqual(["PT-IRO-001"]);
    expect(v1.patients[0].runtimeFixture?.fixtureId).toBe("FX-NARVA-IRO-EVACUATION-1.0.0");
    expect(v2.patients[0].runtimeFixture?.fixtureId).toBe("FX-NARVA-IRO-EVACUATION-1.0.1");
    expect(v1.materializationHash).not.toBe(v2.materializationHash);
  });

  test("retains the v72 full-scenario content with identity-only changes", () => {
    const v2 = structuredClone(packagePatientDatasetRegistry.resolve(
      "patients.narva-iro-evacuation.v2")) as any;
    v2.datasetId = "patients.narva-iro-evacuation.v1";
    v2.version = "1";
    v2.patients[0].runtimeFixture!.fixtureId = "FX-NARVA-IRO-EVACUATION-1.0.0";
    expect(sha256Text(stableJson(v2)))
      .toBe("7eea5ca9c008a673b2e04091c74c97653e635324203e73910ed2aafee35274c4");

    const packageCompatibilityView = structuredClone(NARVA_IRO_EXERCISE_PACKAGE) as any;
    packageCompatibilityView.packageVersion = "1.0.0";
    packageCompatibilityView.patientDatasetId = "patients.narva-iro-evacuation.v1";
    packageCompatibilityView.definition.definitionVersion = 1;
    packageCompatibilityView.manifest.packageVersion = "1.0.0";
    packageCompatibilityView.manifest.definitionHash =
      "01c81f180e86f6b66d5a9bcf10b2f6cd6fbd7b884274c035f795fa52c05dde84";
    expect(calculateExercisePackageHash(packageCompatibilityView))
      .toBe("cc3bf334088f4790032ab602d506686adf4bcc7618081f73e36fcc61146b179c");
  });

  test("freezes the raw, composed and dataset hashes for both versions", () => {
    const v1 = exercisePackageRegistry.require(PACKAGE_ID, "1.0.0");
    const v2 = exercisePackageRegistry.require(PACKAGE_ID, "1.0.1");
    expect(v1).toMatchObject({
      packageHash: "8ab413dad6025b2b60d8a5acefc879cd972fbdc4b5bdec879b811db9f788e1f8",
      manifest: { definitionHash: "f1b145cd0750f659354aaa6558cacdca8486bd483114c0231618de064a19d86a" },
    });
    expect(v2).toMatchObject({
      packageHash: "da184dfe5e9916fc4f401470cb3715b353746950630d892c3acf33c393fa2b95",
      manifest: { definitionHash: "6c099abc91940639891adb36fa4a1e91e9f0c39336b769ec96622b7f4eecdfd0" },
    });
    expect(sha256Text(stableJson(packagePatientDatasetRegistry.resolve("patients.narva-iro-evacuation.v1"))))
      .toBe("20a51862ed3df9d37437c227447d10a0e0d16e9ca131e0af3ebe421e1014a87c");
    expect(sha256Text(stableJson(packagePatientDatasetRegistry.resolve("patients.narva-iro-evacuation.v2"))))
      .toBe("8f6f105025fc273d35cfbd870ae0dd96d6d8981543c1f4824f3da41dd3eee39c");
  });

  test("keeps required module, provider and process registrations unique", () => {
    for (const pkg of [
      exercisePackageRegistry.require(PACKAGE_ID, "1.0.0"),
      exercisePackageRegistry.require(PACKAGE_ID, "1.0.1"),
    ]) {
      expect(new Set(pkg.requiredClinicalModules?.map(item => `${item.moduleId}@${item.version}`)).size)
        .toBe(pkg.requiredClinicalModules?.length);
      expect(new Set(pkg.enabledPatientProcesses).size).toBe(pkg.enabledPatientProcesses.length);
      expect(new Set(pkg.enabledAnalyticsProviders).size).toBe(pkg.enabledAnalyticsProviders.length);
      expect(new Set(pkg.enabledMetricProviders).size).toBe(pkg.enabledMetricProviders.length);
      const registrations = pkg.definition.clinicalModuleComposition?.registrations;
      expect(new Set(registrations?.patientProcesses).size).toBe(registrations?.patientProcesses.length);
      expect(new Set(registrations?.analyticsProviders).size).toBe(registrations?.analyticsProviders.length);
      expect(new Set(registrations?.metricProviders).size).toBe(registrations?.metricProviders.length);
    }
  });
});
