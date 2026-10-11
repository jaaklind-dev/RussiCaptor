import fs from "node:fs";
import path from "node:path";

import {
  captureProjectionPublicationStamp,
  projectionPublicationStampIsCurrent,
  sameProjectionPublicationGeneration,
  type ProjectionPublicationContext,
} from "../ExerciseProjectionPublicationGuard";

const source = fs.readFileSync(path.resolve(process.cwd(), "src/services/CloudSyncService.ts"), "utf8");

function context(overrides: Partial<ProjectionPublicationContext> = {}): ProjectionPublicationContext {
  return {
    exerciseId: "EX-1", lifecycleState: "RUNNING", selectedMode: "EXCON",
    writerAuthority: "WRITER", reader: { exerciseId: "EX-1", phase: "WRITER" },
    readerGeneration: 7, runtimeGeneration: 9, writerGeneration: 5, writerLeaseId: "lease-A", authGeneration: 3, cloudGeneration: 2,
    syncVersion: 11, mutationGeneration: 1, publishedMutationGeneration: 0,
    ...overrides,
  };
}

describe("exercise projection publication authority", () => {
  test("EXSTATE-PUB-01 workbench mount is read-only without a local mutation", () => {
    expect(captureProjectionPublicationStamp(context({ mutationGeneration: 0 }))).toBeUndefined();
    expect(source).toContain("localProjectionMutationGeneration <= publishedProjectionMutationGeneration) return undefined;");
  });

  test("EXSTATE-PUB-02 hydrated PAUSED cannot overwrite RUNNING while restore is pending", () => {
    expect(captureProjectionPublicationStamp(context({ lifecycleState: "PAUSED",
      reader: { exerciseId: "EX-1", phase: "SYNCHRONIZING" } }))).toBeUndefined();
    expect(source).toContain("captureProjectionPublicationStamp(currentProjectionPublicationContext())");
  });

  test("EXSTATE-PUB-03 queued publication is revalidated before network send", () => {
    const stamp = captureProjectionPublicationStamp(context())!;
    expect(projectionPublicationStampIsCurrent(stamp, context({ syncVersion: 12 }))).toBe(false);
    expect(source.indexOf("projectionPublicationStampIsCurrent(publicationStamp")).toBeLessThan(
      source.indexOf('client.rpc("publish_exercise_state_current_writer"'));
  });

  test("EXSTATE-PUB-04 stale runtime generation cannot publish", () => {
    const stamp = captureProjectionPublicationStamp(context())!;
    expect(projectionPublicationStampIsCurrent(stamp, context({ readerGeneration: 8 }))).toBe(false);
    expect(captureProjectionPublicationStamp(context({ reader: { exerciseId: "EX-1", phase: "SYNCHRONIZING" } }))).toBeUndefined();
  });

  test("EXSTATE-PUB-05 stale writer generation cannot publish", () => {
    const stamp = captureProjectionPublicationStamp(context())!;
    expect(projectionPublicationStampIsCurrent(stamp, context({ writerAuthority: "READER" }))).toBe(false);
    expect(projectionPublicationStampIsCurrent(stamp, context({ readerGeneration: 8 }))).toBe(false);
  });

  test("EXSTATE-PUB-06 mode switch cannot publish cached lifecycle", () => {
    const stamp = captureProjectionPublicationStamp(context())!;
    expect(projectionPublicationStampIsCurrent(stamp, context({ selectedMode: "CM" }))).toBe(false);
  });

  test("EXSTATE-PUB-07 foreground event does not create a mutation intent", () => {
    expect(captureProjectionPublicationStamp(context({ mutationGeneration: 0 }))).toBeUndefined();
    expect(source).toMatch(/returnedToForeground[\s\S]*?scheduleCloudSave\("APPSTATE_RESUME"\)/);
    expect(source).toMatch(/if \(source === "local"\) \{\s*recordLocalProjectionMutation\("LOCAL_STATE_CHANGE"\)/);
  });

  test("EXSTATE-PUB-08 cold-start hydration remains read-only", () => {
    expect(captureProjectionPublicationStamp(context({ mutationGeneration: 0,
      reader: { exerciseId: "EX-1", phase: "SYNCHRONIZING" } }))).toBeUndefined();
    expect(source).toContain("localProjectionMutationGeneration = 0;");
  });

  test("pre-restore mutation intent cannot become publishable after writer takeover", () => {
    expect(captureProjectionPublicationStamp(context({ reader: { exerciseId: "EX-1", phase: "SYNCHRONIZING" } }))).toBeUndefined();
    const oldOrigin = captureProjectionPublicationStamp(context())!;
    const newWriter = captureProjectionPublicationStamp(context({ readerGeneration: 8, mutationGeneration: 2 }))!;
    expect(sameProjectionPublicationGeneration(oldOrigin, newWriter)).toBe(false);
    expect(source).toContain("localProjectionMutationIntent = createProjectionPublicationIntent(stamp, origin);");
    expect(source).toContain("!sameProjectionPublicationGeneration(localProjectionMutationIntent.stamp, publicationStamp)");
  });

  test("EXSTATE-PUB-09 supported PAUSE mutation remains publishable by current writer", () => {
    expect(captureProjectionPublicationStamp(context({ lifecycleState: "PAUSED" }))).toBeDefined();
  });

  test("EXSTATE-PUB-10 supported RESUME mutation remains publishable by current writer", () => {
    expect(captureProjectionPublicationStamp(context({ lifecycleState: "RUNNING", mutationGeneration: 2 }))).toBeDefined();
  });

  test("EXSTATE-PUB-11 supported START remains publishable after writer readiness", () => {
    expect(captureProjectionPublicationStamp(context({ lifecycleState: "RUNNING" }))).toBeDefined();
  });

  test("EXSTATE-PUB-12 explicit terminal reconciliation remains available", () => {
    expect(captureProjectionPublicationStamp(context({ lifecycleState: "COMPLETED",
      writerAuthority: "READER", reader: { phase: "UNTRACKED" } }))).toBeDefined();
    expect(source).toMatch(/publishExplicitlySelectedTerminalExercise[\s\S]*?recordLocalProjectionMutation\("EXPLICIT_TERMINAL_RECONCILIATION"\)/);
  });

  test("EXSTATE-PUB-13 canonical rebase invalidates old candidate and permits a new one", () => {
    const old = captureProjectionPublicationStamp(context())!;
    const rebased = context({ readerGeneration: 8, syncVersion: 12, mutationGeneration: 2 });
    expect(projectionPublicationStampIsCurrent(old, rebased)).toBe(false);
    expect(captureProjectionPublicationStamp(rebased)).toBeDefined();
  });

  test("EXSTATE-PUB-14 stale candidate leaves authoritative server state untouched", () => {
    const stale = captureProjectionPublicationStamp(context())!;
    const upsert = jest.fn();
    if (projectionPublicationStampIsCurrent(stale, context({ lifecycleState: "PAUSED" }))) upsert();
    expect(upsert).not.toHaveBeenCalled();
  });

  test("EXSTATE-PUB-15 published mutation is idempotent", () => {
    expect(captureProjectionPublicationStamp(context({ publishedMutationGeneration: 1 }))).toBeUndefined();
  });

  test("wrong exercise, session or cloud generation invalidates a candidate", () => {
    const stamp = captureProjectionPublicationStamp(context())!;
    expect(projectionPublicationStampIsCurrent(stamp, context({ exerciseId: "EX-2" }))).toBe(false);
    expect(projectionPublicationStampIsCurrent(stamp, context({ authGeneration: 4 }))).toBe(false);
    expect(projectionPublicationStampIsCurrent(stamp, context({ cloudGeneration: 3 }))).toBe(false);
  });

  test("current writer may replace an older queued payload with its latest local mutation", () => {
    const queued = captureProjectionPublicationStamp(context())!;
    const latest = captureProjectionPublicationStamp(context({ syncVersion: 12, mutationGeneration: 2 }))!;
    expect(projectionPublicationStampIsCurrent(queued, context({ syncVersion: 12, mutationGeneration: 2 }))).toBe(false);
    expect(sameProjectionPublicationGeneration(queued, latest)).toBe(true);
    expect(sameProjectionPublicationGeneration(queued, captureProjectionPublicationStamp(
      context({ readerGeneration: 8, mutationGeneration: 2 }))!)).toBe(false);
    expect(source).toContain("const latest = prepareCloudProjection();");
    expect(source).toContain("sameProjectionPublicationGeneration(");
  });
});
