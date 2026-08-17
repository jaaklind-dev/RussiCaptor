import { DEFAULT_EXERCISE_PACKAGE, ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { createExercisePackage } from "@/services/exercise/ExercisePackageHash";
import { getExercisePackage, exercisePackageLoader, exercisePackageValidator } from "@/services/exercise/ExercisePackageService";
import { reconstructDebrief } from "@/services/debrief/DebriefEngine";
import { stableJson } from "@/utils/stableJson";
import { createProtocolConfiguration } from "../ProtocolConfigurationHash";
import { ProtocolConfigurationRegistry } from "../ProtocolConfigurationRegistry";
import { ProtocolConfigurationValidator } from "../ProtocolConfigurationValidator";
import { ALS_GENERIC_V1 } from "../ReferenceProtocolConfigurations";

describe("WP-37 ALS Protocol Configuration Framework", () => {
  test("creates recursively immutable exact-version configuration with deterministic hash", () => {
    const reordered = createProtocolConfiguration({ ...structuredClone(ALS_GENERIC_V1),
      tags: [...ALS_GENERIC_V1.tags].reverse(), requiredCapabilities: [...ALS_GENERIC_V1.requiredCapabilities].reverse(),
      rules: [...ALS_GENERIC_V1.rules].reverse(), assessmentExpectations: [...ALS_GENERIC_V1.assessmentExpectations].reverse() });
    expect(reordered.protocolHash).toBe(ALS_GENERIC_V1.protocolHash);
    expect(ALS_GENERIC_V1.protocolHash).toBe("a12f8ae9fdf807b305fd547cde4c8aaef007a11f9d9a9ebc3b7170891bf732e6");
    expect(Object.isFrozen(ALS_GENERIC_V1)).toBe(true); expect(Object.isFrozen(ALS_GENERIC_V1.rules)).toBe(true);
    expect(ALS_GENERIC_V1).toMatchObject({ protocolId: "ALS_GENERIC_V1", version: "1.0.0", status: "ACTIVE" });
  });

  test("registry resolves exact versions, enumerates deterministically and fails closed", () => {
    const registry = new ProtocolConfigurationRegistry();
    const second = createProtocolConfiguration({ ...structuredClone(ALS_GENERIC_V1), version: "1.1.0", name: "Second" });
    registry.register(second); registry.register(ALS_GENERIC_V1);
    expect(registry.list().map(item => item.version)).toEqual(["1.0.0", "1.1.0"]);
    expect(registry.require({ protocolId: "ALS_GENERIC_V1", version: "1.0.0" })).toBe(ALS_GENERIC_V1);
    expect(() => registry.require({ protocolId: "ALS_GENERIC_V1", version: "latest" })).toThrow("UNKNOWN_PROTOCOL_CONFIGURATION");
    expect(() => registry.register(ALS_GENERIC_V1)).toThrow("DUPLICATE_PROTOCOL_CONFIGURATION");
  });

  test("validates canonical rhythm/action/capability and declarative rule semantics", () => {
    expect(new ProtocolConfigurationValidator().validate(ALS_GENERIC_V1)).toEqual([]);
    const invalid = { ...structuredClone(ALS_GENERIC_V1), rhythmCategories: { ...structuredClone(ALS_GENERIC_V1.rhythmCategories), NON_SHOCKABLE: ["VF"] },
      rules: [{ ruleId: "BAD", condition: { rhythm: "VF", rhythmClassification: "NON_SHOCKABLE" }, action: "DEFIBRILLATION" }],
      requiredCapabilities: ["NOT_CANONICAL"] } as typeof ALS_GENERIC_V1;
    expect(new Set(new ProtocolConfigurationValidator().validate(invalid).map(item => item.code))).toEqual(expect.objectContaining(new Set(["INVALID_HASH", "UNKNOWN_CAPABILITY", "CONTRADICTORY_RHYTHM_CATEGORY"])));
  });

  test("binds one exact protocol through Package loader and resolves immutable provenance", () => {
    const pkg = exercisePackageLoader.load(ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE);
    expect(exercisePackageValidator.compatibility(pkg)).toBe("SUPPORTED");
    expect(pkg.protocolConfiguration).toEqual({ protocolId: "ALS_GENERIC_V1", version: "1.0.0" });
    expect(pkg.definition.protocolProvenance).toMatchObject({ protocolId: "ALS_GENERIC_V1", version: "1.0.0",
      protocolHash: ALS_GENERIC_V1.protocolHash, packageId: pkg.packageId });
    expect(pkg.definition.protocolProvenance?.requiredCapabilities).toEqual(ALS_GENERIC_V1.requiredCapabilities);
    expect(pkg.definition.protocolProvenance?.resolvedCapabilities).toEqual(expect.arrayContaining(ALS_GENERIC_V1.requiredCapabilities));
    expect(Object.isFrozen(pkg.definition.protocolProvenance)).toBe(true);
  });

  test("rejects unknown protocol and missing capabilities without executing Runtime", () => {
    const unknown = createExercisePackage({ ...structuredClone(ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE), packageId: "wp37.unknown",
      definition: { ...structuredClone(ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE.definition), exerciseTypeId: "WP37_UNKNOWN_PROTOCOL", protocolProvenance: undefined },
      protocolConfiguration: { protocolId: "UNKNOWN", version: "1.0.0" } });
    expect(() => exercisePackageLoader.load(unknown)).toThrow("PROTOCOL_COMPOSITION_FAILED:UNKNOWN_PROTOCOL");
    const missing = createExercisePackage({ ...structuredClone(DEFAULT_EXERCISE_PACKAGE), packageId: "wp37.missing",
      definition: { ...structuredClone(DEFAULT_EXERCISE_PACKAGE.definition), exerciseTypeId: "WP37_MISSING_CAPABILITY" },
      protocolConfiguration: { protocolId: "ALS_GENERIC_V1", version: "1.0.0" } });
    expect(() => exercisePackageLoader.load(missing)).toThrow("PROTOCOL_COMPOSITION_FAILED:MISSING_PROTOCOL_CAPABILITY");
  });

  test("leaves historical package hashes and protocol-free Debrief byte-identical", () => {
    expect(DEFAULT_EXERCISE_PACKAGE.packageHash).toBe("a32f63f6730596a8491279213bd4ac0c7806efe96b157992beeb3183edb266ae");
    expect(DEFAULT_EXERCISE_PACKAGE.manifest.definitionHash).toBe("b488182cd19a1e09dbb0dcd23de1db0c922782ceb0ae4e6903b45d533409a81b");
    expect(getExercisePackage("demo").definition.protocolProvenance).toBeUndefined();
    const source = { exercise: { exerciseId: "OLD", lifecycleState: "COMPLETED" as const, simulationTimeSec: 1, speed: 1 as const, version: 1 }, patients: [], timeline: [] };
    expect(stableJson(reconstructDebrief(source))).toBe(stableJson(reconstructDebrief({ ...source, protocolProvenance: undefined })));
  });

  test("adds read-only protocol provenance to Debrief without participant judgement", () => {
    const provenance = exercisePackageLoader.load(ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE).definition.protocolProvenance!;
    const report = reconstructDebrief({ exercise: { exerciseId: "WP37", lifecycleState: "COMPLETED", simulationTimeSec: 10, speed: 1, version: 1 }, patients: [], timeline: [], protocolProvenance: provenance });
    expect(report.protocolProvenance).toEqual(provenance); expect(Object.isFrozen(report.protocolProvenance)).toBe(true);
    expect(report).not.toHaveProperty("protocolScore"); expect(report).not.toHaveProperty("protocolAdherence");
  });
});
