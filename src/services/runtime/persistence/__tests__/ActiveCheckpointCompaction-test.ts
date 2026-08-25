import type { SharedExerciseState } from "@/models/SharedExerciseState";
import type { VitalSignEvent } from "@/models/VitalSign";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { physiologicDecompensationFixture } from "@/services/exercise/CanonicalPatientDatasets";
import type { CompletedExerciseArchive } from "@/services/exercise/CompletedExerciseArchiveService";
import {
  archiveForExercise,
  compactActiveExerciseState,
  withTerminalExerciseArchive,
} from "../ActiveCheckpointCompaction";
import { ACTIVE_CHECKPOINT_VITAL_EVENT_LIMIT, boundedVitalSignEvents } from "../VitalHistoryCompaction";
import { canonicalRuntimePersistenceService } from "../CanonicalRuntimePersistenceService";
import { PERSISTED_RUNTIME_SCHEMA_VERSION } from "@/models/PersistedRuntimeState";
import type { GoldenInputEvent } from "@/models/GoldenTest";

const vitalEvents = (count: number): VitalSignEvent[] => Array.from({ length: count }, (_, index) => ({
  eventType: "VitalSignChanged", timestamp: index, vital: "heartRate", from: index, to: index + 1,
  sourceProcessId: "VITAL_SIGN_ENGINE",
}));

const state = (lifecycleState: "RUNNING" | "COMPLETED", archives: CompletedExerciseArchive[] = []): SharedExerciseState => ({
  exerciseSession: { exerciseId: "EX-CURRENT", lifecycleState, simulationTimeSec: 60 } as SharedExerciseState["exerciseSession"],
  patients: [], assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [], orders: [], notes: [],
  scenarioEvents: [], timelineEvents: [], completedExerciseArchives: archives,
});

const archive = (exerciseId: string, padding = ""): CompletedExerciseArchive => ({
  exerciseId,
  snapshot: { exerciseId, lifecycleState: "COMPLETED", simulationTimeSec: 60 } as CompletedExerciseArchive["snapshot"],
  debrief: { exerciseId, padding } as unknown as CompletedExerciseArchive["debrief"],
  analytics: { exerciseId, padding } as unknown as CompletedExerciseArchive["analytics"],
});

describe("WP-47A3 active checkpoint compaction", () => {
  test("keeps the latest exact derived vital events within a deterministic bound", () => {
    const source = vitalEvents(ACTIVE_CHECKPOINT_VITAL_EVENT_LIMIT + 100);
    const compact = boundedVitalSignEvents(source);
    expect(compact).toHaveLength(ACTIVE_CHECKPOINT_VITAL_EVENT_LIMIT);
    expect(compact).toEqual(source.slice(-ACTIVE_CHECKPOINT_VITAL_EVENT_LIMIT));
    expect(source).toHaveLength(ACTIVE_CHECKPOINT_VITAL_EVENT_LIMIT + 100);
  });

  test("loads a legacy full-history payload and emits compact schema v2 without changing current state", () => {
    const source = new ClinicalScenarioEngine(); source.reset(structuredClone(physiologicDecompensationFixture));
    const full = { ...source.captureRuntimePayload(), vitalSignEvents: vitalEvents(1_000) };
    const resumed = new ClinicalScenarioEngine(); resumed.rehydrateRuntimePayload(full);
    expect(resumed.getRuntimeState()).toEqual(source.getRuntimeState());
    expect(resumed.getVitalSignEvents()).toHaveLength(ACTIVE_CHECKPOINT_VITAL_EVENT_LIMIT);
    const provenance = { exerciseId: "EX-WP47A3", patientId: physiologicDecompensationFixture.patientId!,
      packageId: "PKG", packageVersion: "1", packageHash: "PH", definitionHash: "DH", moduleCompositionHash: "MH" };
    const artifact = canonicalRuntimePersistenceService.capture(resumed, provenance);
    expect(artifact.schemaVersion).toBe(PERSISTED_RUNTIME_SCHEMA_VERSION);
    expect(artifact.payload.vitalSignEvents).toHaveLength(ACTIVE_CHECKPOINT_VITAL_EVENT_LIMIT);
    const legacy = structuredClone({ ...artifact, schemaVersion: 1 as const });
    const legacyResumed = new ClinicalScenarioEngine();
    canonicalRuntimePersistenceService.rehydrate(legacyResumed, legacy, provenance);
    expect(legacyResumed.getRuntimeState()).toEqual(resumed.getRuntimeState());
  });

  test("removes every prior archive from active state regardless of completed-exercise count", () => {
    const ten = Array.from({ length: 10 }, (_, index) => archive(`EX-${index + 1}`, "x".repeat(40_000)));
    const one = compactActiveExerciseState(state("RUNNING", ten.slice(0, 1)));
    const eleven = compactActiveExerciseState(state("RUNNING", ten));
    expect(one.completedExerciseArchives).toBeUndefined();
    expect(eleven.completedExerciseArchives).toBeUndefined();
    expect(JSON.stringify(eleven)).toHaveLength(JSON.stringify(one).length);
  });

  test("never copies not-yet-durable legacy evidence into an active schema-v2 checkpoint", () => {
    const pending = archive("EX-PENDING", "legacy evidence");
    const compact = compactActiveExerciseState(state("RUNNING", [archive("EX-DURABLE"), pending]));
    expect(compact.completedExerciseArchives).toBeUndefined();
  });

  test("stores exactly one immutable self archive in its terminal exercise row", () => {
    const own = archive("EX-CURRENT", "evidence");
    const terminal = withTerminalExerciseArchive(state("COMPLETED", [archive("EX-OLD")]), own);
    expect(terminal.completedExerciseArchives).toEqual([own]);
    expect(withTerminalExerciseArchive(state("RUNNING", [own]), own).completedExerciseArchives).toBeUndefined();
    expect(() => withTerminalExerciseArchive(state("COMPLETED"), archive("EX-OTHER"))).toThrow("COMPLETED_ARCHIVE_EXERCISE_MISMATCH");
    expect(archiveForExercise(terminal.completedExerciseArchives, "EX-CURRENT")).toEqual(own);
    expect(archiveForExercise(terminal.completedExerciseArchives, "EX-MISSING")).toBeUndefined();
  });

  test("keeps 60-minute and four-hour Runtime payloads below the justified 500 KB budget", () => {
    const engine = new ClinicalScenarioEngine(); const fixture = structuredClone(physiologicDecompensationFixture);
    engine.reset(fixture); const patientId = fixture.patientId!;
    const sizes = new Map<number, number>();
    for (let minute = 1; minute <= 240; minute += 1) {
      engine.advanceTo(minute * 60);
      const event: GoldenInputEvent = { sequenceId: "WP47A3", step: minute, offsetSec: minute * 60,
        eventType: "ENGINE_TICK", actor: "ENGINE", target: patientId, eventId: `WP47A3-${minute}`,
        result: "SUCCESS", payload: { tickMin: 1 } };
      engine.dispatch(event);
      if (minute === 60 || minute === 240) sizes.set(minute, new TextEncoder().encode(JSON.stringify(engine.captureRuntimePayload())).byteLength);
    }
    expect(engine.getVitalSignEvents().length).toBeLessThanOrEqual(ACTIVE_CHECKPOINT_VITAL_EVENT_LIMIT);
    expect(sizes.get(60)).toBeLessThan(500_000);
    expect(sizes.get(240)).toBeLessThan(500_000);
    console.info("WP47A3_SIZE_PROFILE", JSON.stringify({ minute60: sizes.get(60), minute240: sizes.get(240) }));
  });
});
