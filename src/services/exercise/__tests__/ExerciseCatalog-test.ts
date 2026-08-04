import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { ActiveExercisePackageService, type ActivePackageStorage } from "../ActiveExercisePackageService";
import { CANONICAL_EXERCISE_PACKAGES } from "../CanonicalExercisePackages";
import { filterExerciseCatalog, listExerciseCatalogTags, type ExerciseCatalogEntry } from "../ExerciseCatalogSelectors";
import { EXERCISE_DEFINITION_CATALOG } from "../ExerciseDefinitionService";
import { ExercisePackageRegistry } from "../ExercisePackageRegistry";
import { getExercisePackage } from "../ExercisePackageService";
import { ExercisePackageValidator } from "../ExercisePackageValidator";

const validator = new ExercisePackageValidator(EXERCISE_DEFINITION_CATALOG);
const entries: readonly ExerciseCatalogEntry[] = CANONICAL_EXERCISE_PACKAGES.map((exercisePackage, index) => Object.freeze({
  exercisePackage,
  compatibility: index === 0 ? "LEGACY" : index === 1 ? "INCOMPATIBLE" : "SUPPORTED",
}));

function setup() {
  const registry = new ExercisePackageRegistry(validator);
  CANONICAL_EXERCISE_PACKAGES.forEach(pkg => registry.register(pkg));
  const values = new Map<string, string>();
  const storage: ActivePackageStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  return { registry, storage, values };
}

describe("WP-30 Exercise Catalog", () => {
  test("sorts by package name and version deterministically", () => {
    const reversed = [...entries].reverse();
    const first = filterExerciseCatalog(reversed, { search: "" }).map(entry => entry.exercisePackage.metadata.name);
    const second = filterExerciseCatalog(entries, { search: "" }).map(entry => entry.exercisePackage.metadata.name);
    expect(first).toEqual(second);
    expect(first).toEqual([...first].sort((a, b) => a.localeCompare(b)));
  });

  test("searches canonical metadata without modifying registry entries", () => {
    const before = JSON.stringify(entries);
    const result = filterExerciseCatalog(entries, { search: "botulism" });
    expect(result.some(entry => entry.exercisePackage.definition.profile === "BOTULISM")).toBe(true);
    expect(JSON.stringify(entries)).toBe(before);
  });

  test("filters profile, compatibility and tags as presentation state", () => {
    expect(filterExerciseCatalog(entries, { search: "", profile: "TRAUMA" }).map(item => item.exercisePackage.definition.profile)).toEqual(["TRAUMA"]);
    expect(filterExerciseCatalog(entries, { search: "", compatibility: "INCOMPATIBLE" })).toHaveLength(1);
    expect(filterExerciseCatalog(entries, { search: "", tag: "canonical" })).toHaveLength(entries.length);
    expect(listExerciseCatalogTags(entries)).toEqual(expect.arrayContaining(["canonical", "template"]));
  });

  test("persists exactly one active package and reloads it", () => {
    const { registry, storage } = setup();
    const service = new ActiveExercisePackageService(registry, storage);
    const first = CANONICAL_EXERCISE_PACKAGES[0];
    const second = CANONICAL_EXERCISE_PACKAGES[1];
    service.activate(first.packageId, first.packageVersion);
    service.activate(second.packageId, second.packageVersion);
    expect(service.getActive()).toBe(second);
    expect(service.isActive(first)).toBe(false);
    expect(service.isActive(second)).toBe(true);
    expect(new ActiveExercisePackageService(registry, storage).getActive()).toBe(second);
  });

  test("activation emits one deterministic audit and same selection is idempotent", () => {
    const { registry, storage } = setup();
    const service = new ActiveExercisePackageService(registry, storage);
    const pkg = CANONICAL_EXERCISE_PACKAGES[2];
    let notifications = 0;
    service.subscribe(() => { notifications += 1; });
    service.activate(pkg.packageId, pkg.packageVersion);
    service.activate(pkg.packageId, pkg.packageVersion);
    expect(service.getAudit()).toEqual([{ sequenceNumber: 1, eventType: "ActiveExercisePackageSelected", activePackageKey: `${pkg.packageId}@${pkg.packageVersion}` }]);
    expect(notifications).toBe(1);
  });

  test("rejects unknown packages without changing persisted selection", () => {
    const { registry, storage, values } = setup();
    const service = new ActiveExercisePackageService(registry, storage);
    expect(() => service.activate("unknown", "1.0.0")).toThrow("UNKNOWN_EXERCISE_PACKAGE");
    expect(service.getActive()).toBeUndefined();
    expect(values.size).toBe(0);
  });

  test("catalog activation does not bind or start the current exercise runtime", () => {
    const { registry, storage } = setup();
    const service = new ActiveExercisePackageService(registry, storage);
    const runtimePackageBefore = getExercisePackage("demo");
    const snapshotBefore = getCanonicalExerciseSnapshot();
    const selected = CANONICAL_EXERCISE_PACKAGES.find(pkg => pkg.packageId !== runtimePackageBefore.packageId)!;
    service.activate(selected.packageId, selected.packageVersion);
    expect(getExercisePackage("demo")).toBe(runtimePackageBefore);
    expect(getCanonicalExerciseSnapshot()).toEqual(snapshotBefore);
  });

  test("filters 100 catalog entries within the presentation performance budget", () => {
    const hundred = Object.freeze(Array.from({ length: 100 }, (_, index) => entries[index % entries.length]));
    const started = Date.now();
    expect(filterExerciseCatalog(hundred, { search: "canonical", tag: "template" })).toHaveLength(100);
    expect(Date.now() - started).toBeLessThan(100);
  });
});
