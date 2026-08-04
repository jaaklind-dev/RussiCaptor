import type { ExerciseDefinition } from "@/models/exercise/ExerciseDefinition";
import { AnalyticsProviderRegistry } from "@/services/analytics/AnalyticsProviderRegistry";
import { ExerciseMetricsProvider } from "@/services/analytics/providers/ExerciseMetricsProvider";
import { generateAnalytics } from "@/services/analytics/AnalyticsEngine";
import { DEFAULT_ANALYTICS_PRECISION } from "@/services/analytics/AnalyticsPrecision";
import { reconstructDebrief } from "@/services/debrief/DebriefEngine";
import { DEFAULT_EXERCISE_DEFINITION, EXERCISE_DEFINITION_CATALOG, getExerciseDefinition, isPatientProcessEnabled } from "../ExerciseDefinitionService";
import { ExerciseDefinitionRegistry, hashExerciseDefinition } from "../ExerciseDefinitionRegistry";
import { ExerciseDefinitionValidator } from "../ExerciseDefinitionValidator";

const definition = (overrides: Partial<ExerciseDefinition> = {}): ExerciseDefinition => ({ ...structuredClone(DEFAULT_EXERCISE_DEFINITION), exerciseTypeId: "TEST", ...overrides });
const validator = new ExerciseDefinitionValidator(EXERCISE_DEFINITION_CATALOG);

describe("WP-27 Exercise Definition Framework", () => {
  test("validates typed, known and unique configuration", () => {
    expect(validator.validate(definition())).toEqual([]);
    const invalid = definition({ definitionVersion: 0, profile: "UNKNOWN" as never, enabledPatientProcesses: ["HYPOXIA", "HYPOXIA", "UNKNOWN"], capabilities: ["UNKNOWN" as never], objectives: [{ objectiveId: "", name: "", description: "" }] });
    expect(new Set(validator.validate(invalid).map(issue => issue.code))).toEqual(new Set(["INVALID_VERSION", "UNKNOWN_PROFILE", "DUPLICATE_VALUE", "UNKNOWN_PATIENT_PROCESS", "UNKNOWN_CAPABILITY", "INVALID_OBJECTIVE"]));
  });

  test("registry preserves versions, immutability, uniqueness and deterministic order", () => {
    const registry = new ExerciseDefinitionRegistry(validator, [definition({ exerciseTypeId: "Z", definitionVersion: 2 }), definition({ exerciseTypeId: "A", definitionVersion: 1 })]);
    expect(registry.definitions.map(item => `${item.exerciseTypeId}@${item.definitionVersion}`)).toEqual(["A@1", "Z@2"]);
    expect(Object.isFrozen(registry.require("A", 1))).toBe(true);
    expect(() => registry.register(definition({ exerciseTypeId: "A", definitionVersion: 1 }))).toThrow("DUPLICATE_EXERCISE_DEFINITION");
    expect(registry.get("A", 2)).toBeUndefined();
  });

  test("definition hash is stable across input collection insertion order", () => {
    const a = definition({ enabledPatientProcesses: ["HYPOXIA", "RESPIRATORY_FAILURE"] });
    const b = definition({ enabledPatientProcesses: ["RESPIRATORY_FAILURE", "HYPOXIA"] });
    expect(hashExerciseDefinition(a)).toBe(hashExerciseDefinition(b));
  });

  test("runtime receives an immutable definition and checks enabled modules", () => {
    const current = getExerciseDefinition("demo");
    expect(current.exerciseTypeId).toBe(DEFAULT_EXERCISE_DEFINITION.exerciseTypeId);
    expect(current.definitionVersion).toBe(DEFAULT_EXERCISE_DEFINITION.definitionVersion);
    expect(Object.isFrozen(current)).toBe(true);
    expect(isPatientProcessEnabled("demo", "RESPIRATORY_FAILURE")).toBe(true);
    expect(isPatientProcessEnabled("demo", "UNKNOWN")).toBe(false);
  });

  test("analytics can use definition provider selection without mutating debrief", () => {
    const debrief = reconstructDebrief({ exercise: { exerciseId: "demo", lifecycleState: "COMPLETED", simulationTimeSec: 10, speed: 1, version: 1, clockVersion: 2, clockInitializedAtSimulationTimeSec: 0 }, patients: [], timeline: [] });
    const before = JSON.stringify(debrief); const registry = new AnalyticsProviderRegistry([ExerciseMetricsProvider]);
    const report = generateAnalytics(debrief, registry, { precisionPolicy: DEFAULT_ANALYTICS_PRECISION, enabledProviderIds: ["core.exercise"] });
    expect(report.metrics.length).toBeGreaterThan(0); expect(JSON.stringify(debrief)).toBe(before);
  });

  test("registers and resolves 100 definitions within the configuration budget", () => {
    const started = Date.now(); const registry = new ExerciseDefinitionRegistry(validator);
    for (let index = 0; index < 100; index += 1) registry.register(definition({ exerciseTypeId: `LOAD-${String(index).padStart(3, "0")}` }));
    expect(registry.definitions).toHaveLength(100); expect(Date.now() - started).toBeLessThan(1000);
  });
});
