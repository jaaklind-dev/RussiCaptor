import { resolveCatalogSelection } from "@/components/excon/catalog/ExerciseCatalogScreen";
import { AIRWAY_EXERCISE_PACKAGE, PELVIC_INJURY_EXERCISE_PACKAGE, PLEURAL_INJURY_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { ActiveExercisePackageService } from "@/services/exercise/ActiveExercisePackageService";
import { filterExerciseCatalog, type ExerciseCatalogEntry } from "@/services/exercise/ExerciseCatalogSelectors";
import { exercisePackageRegistry, exercisePackageValidator } from "@/services/exercise/ExercisePackageService";

const packages = [AIRWAY_EXERCISE_PACKAGE, PELVIC_INJURY_EXERCISE_PACKAGE, PLEURAL_INJURY_EXERCISE_PACKAGE];
const entries: ExerciseCatalogEntry[] = packages.map(exercisePackage => ({ exercisePackage, compatibility: exercisePackageValidator.compatibility(exercisePackage) }));
const key = (entry?: ExerciseCatalogEntry) => entry && `${entry.exercisePackage.packageId}@${entry.exercisePackage.packageVersion}`;

describe("Exercise Catalog package selection", () => {
  test.each([
    ["Airway", AIRWAY_EXERCISE_PACKAGE.packageId],
    ["Pelvic", PELVIC_INJURY_EXERCISE_PACKAGE.packageId],
    ["Pleural", PLEURAL_INJURY_EXERCISE_PACKAGE.packageId],
  ])("each filtered %s card resolves its own exact package", (search, packageId) => {
    const filtered = filterExerciseCatalog(entries, { search });
    expect(filtered).toHaveLength(1);
    expect(resolveCatalogSelection(filtered, key(entries[0]))?.exercisePackage.packageId).toBe(packageId);
  });

  test("filtering replaces stale detail selection deterministically", () => {
    const airwayKey = key(entries.find(entry => entry.exercisePackage.packageId === AIRWAY_EXERCISE_PACKAGE.packageId));
    const pelvic = filterExerciseCatalog(entries, { search: "Pelvic" });
    expect(resolveCatalogSelection(pelvic, airwayKey)?.exercisePackage.packageId).toBe(PELVIC_INJURY_EXERCISE_PACKAGE.packageId);
    const pleural = filterExerciseCatalog(entries, { search: "Pleural" });
    expect(resolveCatalogSelection(pleural, airwayKey)?.exercisePackage.packageId).toBe(PLEURAL_INJURY_EXERCISE_PACKAGE.packageId);
    expect(resolveCatalogSelection([], airwayKey)).toBeUndefined();
  });

  test("activation applies the exact package represented by selected detail", () => {
    const stored = new Map<string, string>();
    const service = new ActiveExercisePackageService(exercisePackageRegistry, {
      getItem: item => stored.get(item) ?? null,
      setItem: (item, value) => { stored.set(item, value); },
    });
    for (const entry of entries) {
      const selected = resolveCatalogSelection(entries, key(entry))!;
      const active = service.activate(selected.exercisePackage.packageId, selected.exercisePackage.packageVersion);
      expect(active.packageId).toBe(entry.exercisePackage.packageId);
    }
  });
});
