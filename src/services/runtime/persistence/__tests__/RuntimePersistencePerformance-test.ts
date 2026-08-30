import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import type { GoldenInputEvent } from "@/models/GoldenTest";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { PLEURAL_INJURY_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { canonicalRuntimePersistenceService, moduleCompositionHash } from "../CanonicalRuntimePersistenceService";
import { createRuntimeCheckpoint, createRuntimeCheckpointAsync, localRuntimeCheckpointStore } from "../RuntimeCheckpointAuthorityService";
import { stableJson, stableJsonAsync } from "@/utils/stableJson";
import { sha256Text, sha256TextAsync } from "@/utils/sha256";
import { BoundedObsoleteGenerationGate, LatestGenerationPipeline } from "../LatestGenerationPipeline";
import { createRuntimeCheckpointDelta } from "../RuntimeCheckpointDeltaService";

function fixture(pkg: ExercisePackage) {
  return structuredClone(packagePatientDatasetRegistry.resolve(pkg.patientDatasetId).patients[0].runtimeFixture!);
}

function tick(patientId: string, step: number): GoldenInputEvent {
  return { sequenceId: "WP44B-PERF", step, offsetSec: step * 60, eventType: "ENGINE_TICK", actor: "ENGINE",
    target: patientId, eventId: `WP44B-PERF-${step}`, result: "SUCCESS", payload: { tickMin: 1 } };
}

describe("WP-44B canonical persistence performance", () => {
  test("yielding canonical JSON and SHA are byte-identical to synchronous contracts", async () => {
    const values = [
      { z: [1, undefined, "õ\ud800"], a: { nested: true, omitted: undefined } },
      [null, false, -1, "😀", { b: 2, a: 1 }],
      { number: Number.NaN, infinity: Number.POSITIVE_INFINITY },
    ];
    for (const value of values) {
      const synchronous = stableJson(value);
      expect(await stableJsonAsync(value, { yieldEvery: 1 })).toBe(synchronous);
      expect(await sha256TextAsync(synchronous, { charactersPerSlice: 2, blocksPerSlice: 1 })).toBe(sha256Text(synchronous));
    }
  });

  test("latest-generation pipeline is one-active, coalesces mutations and yields to timers", async () => {
    const prepared: number[] = []; let active = 0; let maximumActive = 0; let timerTicks = 0;
    const timer = setInterval(() => { timerTicks += 1; }, 0);
    const pipeline = new LatestGenerationPipeline(async (generation, yieldControl) => {
      active += 1; maximumActive = Math.max(maximumActive, active);
      for (let index = 0; index < 8; index += 1) await yieldControl();
      prepared.push(generation); active -= 1;
    });
    pipeline.request();
    for (let generation = 0; generation < 20; generation += 1) pipeline.request();
    await pipeline.idle(); clearInterval(timer);
    expect(maximumActive).toBe(1);
    expect(prepared.at(-1)).toBe(21);
    expect(prepared.length).toBeLessThanOrEqual(2);
    expect(pipeline.peakQueuedGenerations()).toBeLessThanOrEqual(1);
    expect(timerTicks).toBeGreaterThan(2);

    const obsoleteGate = new BoundedObsoleteGenerationGate();
    expect([false, false, false, true].map(current => obsoleteGate.shouldDrop(current)))
      .toEqual([true, false, true, false]);
  });

  test("reuses a validated immutable Runtime artifact and does not starve a renewal-like timer", async () => {
    const pkg = PLEURAL_INJURY_EXERCISE_PACKAGE;
    const sourceFixture = fixture(pkg); const patientId = sourceFixture.patientId!;
    const engine = new ClinicalScenarioEngine(); engine.reset(sourceFixture);
    for (let step = 1; step <= 240; step += 1) {
      engine.advanceTo(step * 60); engine.dispatch(tick(patientId, step));
    }
    const provenance = { exerciseId: "EX-WP44B-PERF", patientId, packageId: pkg.packageId,
      packageVersion: pkg.packageVersion, packageHash: pkg.packageHash, definitionHash: pkg.manifest.definitionHash,
      moduleCompositionHash: moduleCompositionHash(pkg.definition.clinicalModuleComposition?.modules ?? pkg.requiredClinicalModules ?? []) };

    const captureStarted = performance.now();
    const artifact = canonicalRuntimePersistenceService.capture(engine, provenance);
    const captureMs = performance.now() - captureStarted;
    const asyncArtifact = await canonicalRuntimePersistenceService.captureAsync(
      engine,
      provenance,
      () => new Promise(resolve => setTimeout(resolve, 0)),
    );
    expect(asyncArtifact).toEqual(artifact);
    const secondPatientId = "PT-WP44B-PERF-2";
    const secondArtifact = canonicalRuntimePersistenceService.capture(engine, { ...provenance, patientId: secondPatientId });
    const canonicalStarted = performance.now();
    const canonical = stableJson(artifact.payload);
    const canonicalizationAndSerializationMs = performance.now() - canonicalStarted;
    const hashStarted = performance.now();
    sha256Text(canonical);
    const hashMs = performance.now() - hashStarted;
    const plainSerializationStarted = performance.now();
    JSON.stringify(artifact.payload);
    const plainSerializationMs = performance.now() - plainSerializationStarted;
    const state: SharedExerciseState = {
      exerciseSession: { exerciseId: provenance.exerciseId, lifecycleState: "RUNNING",
        simulationTimeSec: artifact.capturedAtSimulationTimeSec, startedAtSimulationSec: 0 } as never,
      patients: [{ id: patientId, name: patientId } as never, { id: secondPatientId, name: secondPatientId } as never],
      assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [], orders: [], notes: [],
      scenarioEvents: Array.from({ length: 1_800 }, (_, index) => ({
        id: `PERF-EVENT-${index}`, exerciseId: provenance.exerciseId, patientId: index % 2 ? patientId : secondPatientId,
        type: "PERFORMANCE_FIXTURE", timestamp: index, payload: "x".repeat(600),
      } as never)),
      timelineEvents: [], persistedRuntimeStates: [artifact, secondArtifact],
    };

    // A clone models the pre-optimization path: it has identical bytes but no
    // in-process immutable validation proof, so its Runtime payload is hashed
    // again while the whole checkpoint is prepared.
    const beforeStarted = performance.now();
    const before = createRuntimeCheckpoint({ ...state, persistedRuntimeStates: state.persistedRuntimeStates!.map(item => structuredClone(item)) }, 1);
    const beforeMs = performance.now() - beforeStarted;

    let timerFiredAt = 0; const timerStarted = performance.now();
    const timer = new Promise<void>(resolve => setTimeout(() => { timerFiredAt = performance.now(); resolve(); }, 0));
    const afterStarted = performance.now();
    const after = createRuntimeCheckpoint(state, 1);
    const afterMs = performance.now() - afterStarted;
    await timer;
    const timerDelayMs = timerFiredAt - timerStarted;
    const payloadBytes = new TextEncoder().encode(JSON.stringify(after.payload)).byteLength;
    const sectionBytes = Object.fromEntries(Object.entries(after.payload).map(([key, value]) => [
      key,
      new TextEncoder().encode(JSON.stringify(value)).byteLength,
    ]));
    const nextState = { ...state, exerciseSession: { ...state.exerciseSession, simulationTimeSec: artifact.capturedAtSimulationTimeSec + 1 } } as SharedExerciseState;
    const nextCheckpoint = createRuntimeCheckpoint(nextState, 2);
    const deltaStarted = performance.now();
    const representativeDelta = createRuntimeCheckpointDelta(after, nextCheckpoint);
    const deltaMs = performance.now() - deltaStarted;
    const deltaBytes = new TextEncoder().encode(JSON.stringify(representativeDelta)).byteLength;

    expect(after).toEqual(before);
    expect(after.payloadHash).toBe(before.payloadHash);
    expect(afterMs).toBeLessThan(beforeMs);
    // Hosted CI scheduler jitter can add a few milliseconds after the synchronous
    // checkpoint completes; keep the bound tight while avoiding false failures.
    expect(timerDelayMs).toBeLessThan(300);
    const asyncCheckpoint = await createRuntimeCheckpointAsync(state, 1, () => new Promise(resolve => setTimeout(resolve, 0)));
    expect(asyncCheckpoint).toEqual(after);
    localRuntimeCheckpointStore.restore(undefined);
    const prepared = await localRuntimeCheckpointStore.prepareCaptureAsync(state, () => Promise.resolve());
    expect(localRuntimeCheckpointStore.get()).toBeUndefined();
    const concurrent = localRuntimeCheckpointStore.capture(state);
    expect(localRuntimeCheckpointStore.commitPrepared(prepared)).toBe(false);
    expect(localRuntimeCheckpointStore.get()).toBe(concurrent);
    console.info("WP44B_PERSISTENCE_PROFILE", JSON.stringify({
      patients: 2, processes: artifact.payload.processes.length + secondArtifact.payload.processes.length,
      effects: artifact.payload.medication.effects.length + secondArtifact.payload.medication.effects.length,
      events: artifact.payload.eventLog.length + secondArtifact.payload.eventLog.length + state.scenarioEvents.length, payloadBytes,
      captureMs: Number(captureMs.toFixed(2)), checkpointBeforeMs: Number(beforeMs.toFixed(2)),
      checkpointAfterMs: Number(afterMs.toFixed(2)), timerDelayMs: Number(timerDelayMs.toFixed(2)),
      canonicalizationAndSerializationMs: Number(canonicalizationAndSerializationMs.toFixed(2)),
      hashMs: Number(hashMs.toFixed(2)), plainSerializationMs: Number(plainSerializationMs.toFixed(2)),
      deltaMs: Number(deltaMs.toFixed(2)), deltaBytes, sectionBytes,
    }));
    expect(payloadBytes).toBeGreaterThan(1_500_000);
    expect(payloadBytes).toBeLessThan(2_100_000);
    expect(deltaBytes).toBeLessThan(payloadBytes / 100);
    expect(deltaMs).toBeLessThan(250);
  });
});
