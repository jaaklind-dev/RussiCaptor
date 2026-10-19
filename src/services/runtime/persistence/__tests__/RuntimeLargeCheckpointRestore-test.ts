import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { sha256Text, sha256TextAsync } from "@/utils/sha256";
import { stableJson, stableJsonAsync } from "@/utils/stableJson";
import { createRuntimeCheckpoint, getRuntimeCheckpointCanonicalRepresentation, isValidRuntimeCheckpointAsync,
  restoreRuntimeCheckpointCanonicalRepresentation } from "../RuntimeCheckpointAuthorityService";
import { assertCompleteRestore, assertOriginalSliceLimit, logSample, monotonicNow, phase,
  withMonotonicClock } from "../../../../../test/performance/CheckpointBenchmark";

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
    await withMonotonicClock(async () => {
      // Fixed protocol: original ascending matrix first, then one explicit repeat.
      // No unmeasured warm-up. FIRST is not an Android/app cold-start measurement:
      // module initialization and the original synchronous reference precede it.
      for (const pass of ["FIRST", "REPEAT"] as const) {
        for (const targetMb of [1.8, 3, 4, 8, 12, 16]) {
          const record: Record<string, unknown> = { operation: "CANONICAL_SERIALIZATION_AND_SHA", pass, targetMb };
          const payload = await phase("fixtureMs", () => representativePayload(Math.floor(targetMb * MB)), record);
          const canonical = await phase("referenceSerializationMs", () => stableJson(payload), record);
          const serializationSlices: number[] = [], hashSlices: number[] = [];
          const yieldingCanonical = await phase("serializationMs", () => stableJsonAsync(payload, {
            yieldEvery: 128,
            maxSliceMs: 8,
            yieldControl: async () => Promise.resolve(),
            onSlice: duration => serializationSlices.push(duration),
            traceCategory: "RUNTIME_PAYLOAD",
            objectTraversal: "NATIVE_JSON_SHAPE_TRIE",
          }), record);
          const yieldingHash = await phase("hashMs", () => sha256TextAsync(yieldingCanonical, {
            charactersPerSlice: 8_192,
            blocksPerSlice: 16,
            maxSliceMs: 8,
            yieldControl: async () => Promise.resolve(),
            onSlice: duration => hashSlices.push(duration),
            traceCategory: "RUNTIME_PAYLOAD",
          }), record);
          const referenceHash = await phase("referenceHashMs", () => sha256Text(canonical), record);
          const slices = [...serializationSlices, ...hashSlices];
          // Log EVERY duration before the integrity and performance assertions.
          logSample({ ...record, fixtureId: "WP_NARVA_10B10_6000_EVENT_ROWS_V1", fixtureHash: referenceHash,
            bytes: canonical.length, serializationSlices, hashSlices,
            originalMaximumSliceMs: Math.max(...slices) });
          expect(yieldingCanonical).toBe(canonical);
          expect(yieldingHash).toBe(referenceHash);
          assertOriginalSliceLimit(slices);
        }
      }
    });
  });

  test("a deserialized three-megabyte active checkpoint validates without starving timers", async () => {
    await withMonotonicClock(async () => {
      for (const pass of ["FIRST", "REPEAT"] as const) {
        const record: Record<string, unknown> = { operation: "CHECKPOINT_VALIDATION_AND_CANONICAL_RESTORE", pass };
        const source = await phase("checkpointSetupMs", () => createRuntimeCheckpoint(checkpointState(3 * MB), 26), record);
        const checkpoint = await phase("cloneMs", () => structuredClone(source), record);
        const serializedBytes = (await phase("referenceSerializationMs", () => stableJson(checkpoint.payload), record)).length;
        let timerTicks = 0;
        let maxTimerLagMs = 0;
        let lastTimerAt = monotonicNow();
        const timerGaps: number[] = [];
        const timer = setInterval(() => {
          const now = monotonicNow();
          maxTimerLagMs = Math.max(maxTimerLagMs, now - lastTimerAt);
          timerGaps.push(now - lastTimerAt);
          lastTimerAt = now;
          timerTicks += 1;
        }, 1);
        let valid: boolean;
        try {
          valid = await phase("validationMs", () => isValidRuntimeCheckpointAsync(checkpoint,
            () => new Promise(resolve => setTimeout(resolve, 0))), record);
          await new Promise(resolve => setTimeout(resolve, 0));
        } finally { clearInterval(timer); }
        // Additional observation only: actual canonical-v1 verification, parse and
        // restore. It is NOT substituted for the original validation/timer gates.
        const representation = getRuntimeCheckpointCanonicalRepresentation(source)!;
        const restored = await phase("canonicalRestoreMs", () => restoreRuntimeCheckpointCanonicalRepresentation(
          representation, () => new Promise(resolve => setTimeout(resolve, 0))), record);
        logSample({ ...record, serializedBytes, timerTicks, maxTimerLagMs, timerGaps });
        expect(valid).toBe(true);
        expect(checkpoint.checkpointRevision).toBe(26);
        expect("simulationTimeSec" in checkpoint.payload.exerciseSession
          ? checkpoint.payload.exerciseSession.simulationTimeSec
          : checkpoint.payload.exerciseSession.currentMinute * 60).toBe(2_622);
        expect(serializedBytes).toBeGreaterThan(2.7 * MB);
        expect(serializedBytes).toBeLessThan(3.4 * MB);
        expect(record.validationMs).toBeLessThan(5_000);
        expect(timerTicks).toBeGreaterThan(5);
        expect(maxTimerLagMs).toBeLessThan(250);
        assertCompleteRestore(source, restored);
        expect(await isValidRuntimeCheckpointAsync(restored, async () => Promise.resolve())).toBe(true);
      }
    });
  });
});
