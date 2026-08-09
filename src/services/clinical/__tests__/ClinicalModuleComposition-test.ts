import type { ClinicalModuleRegistrations } from "@/models/clinical/ClinicalModule";
import type { ClinicalModuleDependency } from "@/models/clinical/ClinicalModuleDependency";
import type { ExerciseDefinition } from "@/models/exercise/ExerciseDefinition";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getAnalyticsReport } from "@/services/AnalyticsService";
import { CANONICAL_EXERCISE_PACKAGES, DEFAULT_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { hashExerciseDefinition } from "@/services/exercise/ExerciseDefinitionRegistry";
import { EXERCISE_DEFINITION_CATALOG } from "@/services/exercise/ExerciseDefinitionService";
import { createExercisePackage } from "@/services/exercise/ExercisePackageHash";
import { ExercisePackageLoader } from "@/services/exercise/ExercisePackageLoader";
import { ExercisePackageRegistry } from "@/services/exercise/ExercisePackageRegistry";
import { getExercisePackage } from "@/services/exercise/ExercisePackageService";
import { ExercisePackageValidator } from "@/services/exercise/ExercisePackageValidator";
import { ClinicalModuleComposer } from "../ClinicalModuleComposer";
import { createClinicalModule } from "../ClinicalModuleHash";
import { ClinicalModuleRegistry } from "../ClinicalModuleRegistry";

const emptyRegistrations = (): ClinicalModuleRegistrations => ({
  patientProcesses: [], clinicalEffects: [], interventions: [], medications: [], assessmentRules: [],
  analyticsProviders: [], metricProviders: [], capabilities: [], objectives: [], validationRules: [],
});

const module = (moduleId: string, dependencies: readonly ClinicalModuleDependency[] = [], registrations: Partial<ClinicalModuleRegistrations> = {}, version = "1") => createClinicalModule({
  moduleId, version, manifest: { description: `${moduleId} test module`, dependencies, compatibilityVersion: 1 },
  registrations: { ...emptyRegistrations(), ...registrations },
});

const baseDefinition = (exerciseTypeId = "WP31_COMPOSITION"): ExerciseDefinition => Object.freeze({
  definitionVersion: 1, exerciseTypeId, name: "WP-31 Composition", description: "Composition test definition", profile: "CUSTOM",
  enabledPatientProcesses: Object.freeze([]), enabledAnalyticsProviders: Object.freeze([]), enabledMetricProviders: Object.freeze([]),
  objectives: Object.freeze([]), capabilities: Object.freeze([]),
});

const setup = (...modules: ReturnType<typeof module>[]) => {
  const registry = new ClinicalModuleRegistry(); modules.forEach(item => registry.register(item));
  return { registry, composer: new ClinicalModuleComposer(registry) };
};

describe("WP-31 Clinical Module Composition Foundation", () => {
  test("registry validates identity, hash and uniqueness with deterministic ordering", () => {
    const registry = new ClinicalModuleRegistry(); const z = module("ZETA"); const a = module("ALPHA");
    registry.register(z); registry.register(a);
    expect(registry.modules.map(item => item.moduleId)).toEqual(["ALPHA", "ZETA"]);
    expect(registry.require("ALPHA", "1")).toEqual(a);
    expect(() => registry.register(a)).toThrow("DUPLICATE_CLINICAL_MODULE");
    expect(() => registry.register({ ...a, moduleHash: "invalid" })).toThrow("INVALID_CLINICAL_MODULE_HASH");
  });

  test("module hash is immutable and independent of registration and dependency array order", () => {
    const first = module("HASH", [{ moduleId: "B", version: "1" }, { moduleId: "A", version: "1" }], { patientProcesses: ["HYPOXIA", "HEMORRHAGE"] });
    const second = module("HASH", [{ moduleId: "A", version: "1" }, { moduleId: "B", version: "1" }], { patientProcesses: ["HEMORRHAGE", "HYPOXIA"] });
    expect(first.moduleHash).toBe(second.moduleHash);
    expect(Object.isFrozen(first)).toBe(true); expect(Object.isFrozen(first.registrations.patientProcesses)).toBe(true);
  });

  test("resolves a closed graph in deterministic dependency-first order", () => {
    const core = module("CORE"); const airway = module("AIRWAY", [{ moduleId: "CORE", version: "1" }]);
    const botulism = module("BOTULISM", [{ moduleId: "AIRWAY", version: "1" }]);
    const { composer } = setup(botulism, core, airway);
    const first = composer.compose(baseDefinition(), [{ moduleId: "BOTULISM", version: "1" }]);
    const second = composer.compose(baseDefinition(), [{ moduleId: "BOTULISM", version: "1" }]);
    expect(first).toEqual(second); expect(first.ok).toBe(true);
    if (first.ok) expect(first.composition.modules.map(item => item.moduleId)).toEqual(["CORE", "AIRWAY", "BOTULISM"]);
  });

  test.each([
    ["missing dependency", [module("ROOT", [{ moduleId: "MISSING", version: "1" }])], [{ moduleId: "ROOT", version: "1" }], "MISSING_DEPENDENCY"],
    ["version mismatch", [module("CORE", [], {}, "1")], [{ moduleId: "CORE", version: "2" }], "VERSION_MISMATCH"],
    ["duplicate root", [module("CORE")], [{ moduleId: "CORE", version: "1" }, { moduleId: "CORE", version: "1" }], "DUPLICATE_MODULE_ID"],
    ["version conflict", [module("CORE", [], {}, "1"), module("CORE", [], {}, "2")], [{ moduleId: "CORE", version: "1" }, { moduleId: "CORE", version: "2" }], "VERSION_MISMATCH"],
  ])("rejects %s", (_name, modules, required, code) => {
    const { composer } = setup(...modules as ReturnType<typeof module>[]);
    const result = composer.compose(baseDefinition(), required as ClinicalModuleDependency[]);
    expect(result.ok).toBe(false); expect(result.diagnostics.map(item => item.code)).toContain(code);
  });

  test("rejects cyclic dependency graphs", () => {
    const a = module("A", [{ moduleId: "B", version: "1" }]); const b = module("B", [{ moduleId: "A", version: "1" }]);
    const result = setup(a, b).composer.compose(baseDefinition(), [{ moduleId: "A", version: "1" }]);
    expect(result.ok).toBe(false); expect(result.diagnostics.map(item => item.code)).toContain("CYCLIC_DEPENDENCY");
  });

  test.each([
    ["patientProcesses", "HYPOXIA", "DUPLICATE_PATIENT_PROCESS"],
    ["analyticsProviders", EXERCISE_DEFINITION_CATALOG.analyticsProviders[0], "DUPLICATE_ANALYTICS_PROVIDER"],
    ["metricProviders", EXERCISE_DEFINITION_CATALOG.metricProviders[0], "DUPLICATE_METRIC_PROVIDER"],
    ["capabilities", "TIMELINE", "DUPLICATE_CAPABILITY"],
  ] as const)("rejects duplicate %s registrations", (group, value, code) => {
    const left = module("LEFT", [], { [group]: [value] }); const right = module("RIGHT", [], { [group]: [value] });
    const result = setup(left, right).composer.compose(baseDefinition(), [{ moduleId: "RIGHT", version: "1" }, { moduleId: "LEFT", version: "1" }]);
    expect(result.ok).toBe(false); expect(result.diagnostics.map(item => item.code)).toContain(code);
  });

  test("merges registrations and records deeply immutable provenance", () => {
    const objective = Object.freeze({ objectiveId: "MODULE-OBJ", name: "Module objective", description: "Verify composition" });
    const clinical = module("CLINICAL", [], { patientProcesses: ["HYPOXIA"], analyticsProviders: [EXERCISE_DEFINITION_CATALOG.analyticsProviders[0]], metricProviders: [EXERCISE_DEFINITION_CATALOG.metricProviders[0]], capabilities: ["TIMELINE"], objectives: [objective] });
    const result = setup(clinical).composer.compose(baseDefinition(), [{ moduleId: "CLINICAL", version: "1" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition).toMatchObject({ enabledPatientProcesses: ["HYPOXIA"], capabilities: ["TIMELINE"] });
    expect(result.definition.clinicalModuleComposition?.modules[0]).toMatchObject({ moduleId: "CLINICAL", version: "1", compositionOrder: 0, moduleHash: clinical.moduleHash });
    expect(Object.isFrozen(result.definition)).toBe(true); expect(Object.isFrozen(result.composition.modules)).toBe(true);
  });

  test("Package Loader composes before publishing one canonical Definition", () => {
    const clinical = module("PACKAGE_MODULE", [], { patientProcesses: ["HYPOXIA"], analyticsProviders: [EXERCISE_DEFINITION_CATALOG.analyticsProviders[0]], metricProviders: [EXERCISE_DEFINITION_CATALOG.metricProviders[0]], capabilities: ["TIMELINE"] });
    const { registry: modules, composer } = setup(clinical);
    expect(modules.modules).toHaveLength(1);
    const validator = new ExercisePackageValidator(EXERCISE_DEFINITION_CATALOG); const packages = new ExercisePackageRegistry(validator);
    const loader = new ExercisePackageLoader(validator, packages, composer); const base = baseDefinition("WP31_PACKAGE_DEFINITION");
    const input = createExercisePackage({ packageId: "wp31.package", packageVersion: "1.0.0", definition: base, patientDatasetId: "wp31.patients", enabledPatientProcesses: [], enabledAnalyticsProviders: [], enabledMetricProviders: [], requiredClinicalModules: [{ moduleId: "PACKAGE_MODULE", version: "1" }], metadata: { name: "WP-31 Package", description: "Composition integration", author: "RussiCaptor", organization: "RussiCaptor", createdVersion: "0.7.0", exerciseType: "CUSTOM", tags: ["test"] } });
    const published = loader.load(input);
    expect(published).not.toBe(input); expect(published.requiredClinicalModules).toEqual(input.requiredClinicalModules);
    expect(published.definition.enabledPatientProcesses).toEqual(["HYPOXIA"]);
    expect(published.manifest.definitionHash).toBe(hashExerciseDefinition(published.definition));
    expect(packages.require("wp31.package", "1.0.0")).toBe(published);
  });

  test("packages without modules preserve canonical hashes and runtime-facing state", () => {
    const snapshot = getCanonicalExerciseSnapshot(); const runtimePackage = getExercisePackage(snapshot.exerciseId);
    expect(DEFAULT_EXERCISE_PACKAGE.packageHash).toBe("c6ff142e1cfbdcb37757f159fbbd95128f9ee4a961972d22264c44317b6e803d");
    expect(DEFAULT_EXERCISE_PACKAGE.manifest.definitionHash).toBe("b488182cd19a1e09dbb0dcd23de1db0c922782ceb0ae4e6903b45d533409a81b");
    expect(CANONICAL_EXERCISE_PACKAGES.every(pkg => !pkg.requiredClinicalModules && !pkg.definition.clinicalModuleComposition)).toBe(true);
    expect(getExercisePackage(snapshot.exerciseId)).toBe(runtimePackage); expect(getCanonicalExerciseSnapshot()).toEqual(snapshot);
  });

  test("isolated composition does not change Analytics hash", () => {
    const before = getAnalyticsReport().analyticsHash;
    const isolated = module("ISOLATED"); setup(isolated).composer.compose(baseDefinition(), [{ moduleId: "ISOLATED", version: "1" }]);
    expect(getAnalyticsReport().analyticsHash).toBe(before);
  });

  test("resolves 100 modules and 1000 dependency edges within the configuration budget", () => {
    const modules = Array.from({ length: 100 }, (_, index) => module(`M${String(index).padStart(3, "0")}`, Array.from({ length: Math.min(10, index) }, (_unused, offset) => ({ moduleId: `M${String(index - offset - 1).padStart(3, "0")}`, version: "1" }))));
    const { composer } = setup(...modules); const started = Date.now();
    const result = composer.compose(baseDefinition(), [{ moduleId: "M099", version: "1" }]);
    expect(result.ok).toBe(true); if (result.ok) expect(result.composition.modules).toHaveLength(100);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
