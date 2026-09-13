import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { sha256Text, sha256TextAsync } from "@/utils/sha256";
import { stableJson, stableJsonAsync } from "@/utils/stableJson";
import { createRuntimeCheckpoint, isValidRuntimeCheckpointAsync } from "../RuntimeCheckpointAuthorityService";

jest.setTimeout(120_000);

const MB = 1024 * 1024;

function representativePayload(targetBytes: number) {
  const rowCount = 6_000;
  const bodyLength = Math.max(16, Math.floor(targetBytes / rowCount) - 96);
  return {
    simulationTimeSec: 2_622,
    sequence: rowCount,
    eventLog: Array.from({ length: rowCount }, (_, index) => ({
      id: `SYNTHETIC-IRO-${index}`,
      sequence: index + 1,
      kind: index % 3 === 0 ? "FAULT" : index % 3 === 1 ? "HOLD" : "CLINICAL",
      body: "x".repeat(bodyLength),
    })),
    activeTreatments: ["NOREPINEPHRINE", "PROPOFOL", "REMIFENTANIL", "ROCURONIUM"],
    airway: { type: "ETT", active: true },
    ventilation: { mode: "VOLUME_CONTROL", tidalVolumeMl: 420, respiratoryRate: 14, fio2: 0.4, peep: 8 },
    iroScenario: { ventilationFault: "CIRCUIT_DISCONNECT", hold: true, holdAccumulatedSec: 73 },
  };
}

function checkpointState(targetBytes: number): SharedExerciseState {
  const exerciseId = "EX-SYNTHETIC-LARGE-RESTORE";
  const patientId = "PT-IRO-001";
  const payload = representativePayload(targetBytes);
  return {
    exerciseSession: { exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 2_622, startedAtSimulationSec: 0 } as never,
    patients: [{ id: patientId, name: patientId } as never],
    assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [], orders: [], notes: [],
    scenarioEvents: [], timelineEvents: [],
    persistedRuntimeStates: [{
      schemaVersion: 1,
      provenance: { exerciseId, patientId, packageId: "russicaptor.narva-iro-evacuation", packageVersion: "1.0.1",
        packageHash: "da184dfe5e9916fc4f401470cb3715b353746950630d892c3acf33c393fa2b95",
        definitionHash: "6c099abc91940639891adb36fa4a1e91e9f0c39336b769ec96622b7f4eecdfd0",
        moduleCompositionHash: "synthetic-module-composition" },
      capturedAtSimulationTimeSec: 2_622,
      payload,
      payloadHash: sha256Text(stableJson(payload)),
    } as never],
  };
}

describe("WP-NARVA-10B10 large checkpoint restore", () => {
  test("canonical JSON and hash remain deterministic from 1.8 MB through 16 MB", async () => {
    const profile: Record<string, number>[] = [];
    for (const targetMb of [1.8, 3, 4, 8, 12, 16]) {
      const payload = representativePayload(Math.floor(targetMb * MB));
      const canonical = stableJson(payload);
      const slices: number[] = [];
      const started = performance.now();
      const yieldingCanonical = await stableJsonAsync(payload, {
        yieldEvery: 128,
        maxSliceMs: 8,
        yieldControl: async () => Promise.resolve(),
        onSlice: duration => slices.push(duration),
        traceCategory: "RUNTIME_PAYLOAD",
        objectTraversal: "NATIVE_JSON_SHAPE_TRIE",
      });
      const canonicalMs = performance.now() - started;
      const hashStarted = performance.now();
      const yieldingHash = await sha256TextAsync(yieldingCanonical, {
        charactersPerSlice: 8_192,
        blocksPerSlice: 16,
        maxSliceMs: 8,
        yieldControl: async () => Promise.resolve(),
        onSlice: duration => slices.push(duration),
        traceCategory: "RUNTIME_PAYLOAD",
      });
      const hashMs = performance.now() - hashStarted;
      expect(yieldingCanonical).toBe(canonical);
      expect(yieldingHash).toBe(sha256Text(canonical));
      expect(Math.max(...slices)).toBeLessThan(250);
      profile.push({ targetMb, bytes: canonical.length, canonicalMs: Number(canonicalMs.toFixed(2)),
        hashMs: Number(hashMs.toFixed(2)), maxSliceMs: Number(Math.max(...slices).toFixed(2)) });
    }
    console.info("WP_NARVA_10B10_SIZE_PROFILE", JSON.stringify(profile));
  });

  test("a deserialized three-megabyte active checkpoint validates without starving timers", async () => {
    const checkpoint = structuredClone(createRuntimeCheckpoint(checkpointState(3 * MB), 26));
    const serializedBytes = stableJson(checkpoint.payload).length;
    let timerTicks = 0;
    let maxTimerLagMs = 0;
    let lastTimerAt = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      maxTimerLagMs = Math.max(maxTimerLagMs, now - lastTimerAt);
      lastTimerAt = now;
      timerTicks += 1;
    }, 1);
    const started = performance.now();
    const valid = await isValidRuntimeCheckpointAsync(checkpoint, () => new Promise(resolve => setTimeout(resolve, 0)));
    const restoreMs = performance.now() - started;
    await new Promise(resolve => setTimeout(resolve, 0));
    clearInterval(timer);
    console.info("WP_NARVA_10B10_RESTORE_PROFILE", JSON.stringify({ serializedBytes,
      restoreMs: Number(restoreMs.toFixed(2)), timerTicks, maxTimerLagMs: Number(maxTimerLagMs.toFixed(2)) }));
    expect(valid).toBe(true);
    expect(checkpoint.checkpointRevision).toBe(26);
    expect("simulationTimeSec" in checkpoint.payload.exerciseSession
      ? checkpoint.payload.exerciseSession.simulationTimeSec
      : checkpoint.payload.exerciseSession.currentMinute * 60).toBe(2_622);
    expect(serializedBytes).toBeGreaterThan(2.7 * MB);
    expect(serializedBytes).toBeLessThan(3.4 * MB);
    expect(restoreMs).toBeLessThan(5_000);
    expect(timerTicks).toBeGreaterThan(5);
    expect(maxTimerLagMs).toBeLessThan(250);
  });
});
