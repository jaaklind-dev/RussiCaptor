import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import { CANONICAL_EXERCISE_PACKAGES, DEFAULT_EXERCISE_PACKAGE } from "../CanonicalExercisePackages";
import { createExercisePackage, calculateExercisePackageHash } from "../ExercisePackageHash";
import { ExercisePackageLoader } from "../ExercisePackageLoader";
import { ExercisePackageRegistry } from "../ExercisePackageRegistry";
import { ExercisePackageValidator } from "../ExercisePackageValidator";
import { getExercisePackage } from "../ExercisePackageService";
import { EXERCISE_DEFINITION_CATALOG } from "../ExerciseDefinitionService";
import { withExercisePackageMetadata } from "@/services/analytics/AnalyticsPackageMetadata";
import type { AnalyticsReport } from "@/models/analytics/Analytics";

const validator = new ExercisePackageValidator(EXERCISE_DEFINITION_CATALOG);
const makePackage = (id: string, version = "1.0.0", compatibilityVersion = 1) => createExercisePackage({ ...structuredClone(DEFAULT_EXERCISE_PACKAGE), packageId: id, packageVersion: version, compatibilityVersion, definition: { ...structuredClone(DEFAULT_EXERCISE_PACKAGE.definition), exerciseTypeId: `DEF_${id.replaceAll(".", "_")}_${version.replaceAll(".", "_")}` } });

describe("WP-28 Exercise Package Framework", () => {
  test("ships six immutable canonical configuration-only packages", () => {
    expect(CANONICAL_EXERCISE_PACKAGES.map(pkg => pkg.definition.profile)).toEqual(["ALS", "TRAUMA", "MASCAL", "BOTULISM", "EMERGENCY_DEPARTMENT", "CUSTOM"]);
    for (const pkg of CANONICAL_EXERCISE_PACKAGES) { expect(Object.isFrozen(pkg)).toBe(true); expect(validator.validate(pkg)).toEqual([]); expect(Object.keys(pkg)).not.toEqual(expect.arrayContaining(["runtime", "runtimeState", "timeline", "debrief", "analytics", "replay"])); }
  });

  test("detects manifest, hash, provider and definition failures without mutation", () => {
    const source = makePackage("validation"); const before = JSON.stringify(source);
    const invalid = { ...structuredClone(source), packageHash: "bad", enabledPatientProcesses: ["UNKNOWN"], manifest: { ...source.manifest, packageHash: "bad", definitionHash: "bad" } } as ExercisePackage;
    expect(new Set(validator.validate(invalid).map(issue => issue.code))).toEqual(new Set(["INVALID_HASH", "INVALID_MANIFEST", "UNKNOWN_PATIENT_PROCESS", "INCONSISTENT_SELECTION"]));
    expect(JSON.stringify(source)).toBe(before);
  });

  test("package hash is deterministic and excludes self-reference", () => {
    const a = makePackage("hash"); const reordered = createExercisePackage({ ...structuredClone(DEFAULT_EXERCISE_PACKAGE), packageId: "hash", definition: { ...structuredClone(DEFAULT_EXERCISE_PACKAGE.definition), exerciseTypeId: "DEF_hash_1_0_0" }, enabledPatientProcesses: [...DEFAULT_EXERCISE_PACKAGE.enabledPatientProcesses].reverse(), metadata: { ...DEFAULT_EXERCISE_PACKAGE.metadata, tags: [...DEFAULT_EXERCISE_PACKAGE.metadata.tags].reverse() } });
    expect(a.packageHash).toBe(reordered.packageHash); expect(a.manifest.packageHash).toBe(a.packageHash); expect(calculateExercisePackageHash(a)).toBe(a.packageHash);
  });

  test("WP-28 canonical package and definition hashes remain unchanged", () => {
    expect(DEFAULT_EXERCISE_PACKAGE.packageHash).toBe("c6ff142e1cfbdcb37757f159fbbd95128f9ee4a961972d22264c44317b6e803d");
    expect(DEFAULT_EXERCISE_PACKAGE.manifest.definitionHash).toBe("b488182cd19a1e09dbb0dcd23de1db0c922782ceb0ae4e6903b45d533409a81b");
  });

  test("registry resolves versions deterministically and rejects duplicates", () => {
    const registry = new ExercisePackageRegistry(validator); registry.register(makePackage("registry", "2.0.0")); registry.register(makePackage("registry", "1.0.0"));
    expect(registry.packages.map(pkg => pkg.packageVersion)).toEqual(["1.0.0", "2.0.0"]); expect(registry.latest("registry")?.packageVersion).toBe("2.0.0"); expect(() => registry.register(makePackage("registry", "1.0.0"))).toThrow("DUPLICATE_EXERCISE_PACKAGE");
  });

  test("classifies supported, safely legacy and incompatible packages", () => {
    expect(validator.compatibility(makePackage("supported"))).toBe("SUPPORTED"); expect(validator.compatibility(makePackage("legacy", "1.0.0", 0))).toBe("LEGACY");
    const incompatible = makePackage("future", "1.0.0", 2); expect(validator.compatibility(incompatible)).toBe("INCOMPATIBLE"); expect(validator.validate(incompatible).some(issue => issue.code === "INCOMPATIBLE_PACKAGE")).toBe(true);
  });

  test("loader is the single deterministic package and definition binding authority", () => {
    const registry = new ExercisePackageRegistry(validator); const loader = new ExercisePackageLoader(validator, registry); const pkg = makePackage("loader"); const loaded = loader.bind("EX-PACKAGE", pkg);
    expect(loaded).toBe(pkg); expect(registry.require(pkg.packageId, pkg.packageVersion)).toBe(pkg); expect(loader.getBound("EX-PACKAGE")?.definition.exerciseTypeId).toBe(pkg.definition.exerciseTypeId);
    expect(loader.bind("EX-PACKAGE", pkg)).toBe(pkg);
    const conflict = makePackage("loader-other"); expect(() => loader.bind("EX-PACKAGE", conflict)).toThrow("EXERCISE_PACKAGE_BINDING_CONFLICT"); expect(registry.get(conflict.packageId, conflict.packageVersion)).toBeUndefined();
    expect(getExercisePackage("demo").packageHash).toBe(DEFAULT_EXERCISE_PACKAGE.packageHash);
  });

  test("analytics metadata can record package identity without changing analytics hash", () => {
    const base = Object.freeze({ analyticsHash: "canonical-hash" }) as AnalyticsReport; const analytics = withExercisePackageMetadata(base, DEFAULT_EXERCISE_PACKAGE);
    expect(analytics.analyticsHash).toBe("canonical-hash"); expect(analytics.exercisePackage?.packageHash).toBe(DEFAULT_EXERCISE_PACKAGE.packageHash);
  });

  test("registers 100 packages within the configuration performance budget", () => {
    const registry = new ExercisePackageRegistry(validator); const started = Date.now(); for (let index = 0; index < 100; index += 1) registry.register(makePackage(`load-${index}`));
    expect(registry.packages).toHaveLength(100); expect(Date.now() - started).toBeLessThan(1500);
  });
});
