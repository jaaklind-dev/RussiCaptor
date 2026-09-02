import { publishDerivedSnapshotNotification, runRuntimeDerivedSnapshotTransaction } from "../RuntimeDerivedSnapshotTransaction";

describe("Runtime derived snapshot transaction", () => {
  test("defers and coalesces notifications until the complete generation is installed", () => {
    const observed: string[] = [];
    runRuntimeDerivedSnapshotTransaction(() => {
      publishDerivedSnapshotNotification("runtime", () => observed.push("runtime-old"));
      publishDerivedSnapshotNotification("assessment", () => observed.push("assessment"));
      publishDerivedSnapshotNotification("runtime", () => observed.push("runtime-current"));
      expect(observed).toEqual([]);
    });
    expect(observed).toEqual(["runtime-current", "assessment"]);
  });

  test("flushes safely when publication throws", () => {
    const observed: string[] = [];
    expect(() => runRuntimeDerivedSnapshotTransaction(() => {
      publishDerivedSnapshotNotification("runtime", () => observed.push("runtime"));
      throw new Error("publication failed");
    })).toThrow("publication failed");
    expect(observed).toEqual([]);
  });
});
