import fs from "node:fs";
import path from "node:path";

describe("CM current exercise projection", () => {
  test("subscribes directly to the canonical sync version", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard.tsx"), "utf8");
    expect(source).toContain("useSyncExternalStore(subscribeToSync, getSyncVersion, getSyncVersion)");
    expect(source).toContain("snapshot={getCanonicalExerciseSnapshot()}");
    expect(source).toContain("setPresentationVersion((version) => version + 1)");
  });
});
