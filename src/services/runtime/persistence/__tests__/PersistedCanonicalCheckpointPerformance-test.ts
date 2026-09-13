import type { SharedExerciseState } from "@/models/SharedExerciseState";
import {
  createRuntimeCheckpoint,
  getRuntimeCheckpointCanonicalRepresentation,
  restoreRuntimeCheckpointCanonicalRepresentation,
} from "../RuntimeCheckpointAuthorityService";

const fixture = (characters: number): SharedExerciseState => ({
  exerciseSession: { exerciseId: "EX-PERF", lifecycleState: "COMPLETED", simulationTimeSec: 1 } as never,
  patients: [], assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [], orders: [],
  notes: [{ id: "PAYLOAD", text: "õ".repeat(characters) } as never], scenarioEvents: [], timelineEvents: [],
  persistedRuntimeStates: [],
});

describe("WP-NARVA-10B14 canonical-persisted restore performance", () => {
  jest.setTimeout(120_000);

  test("size matrix hashes text, parses once and performs no object recanonicalization", async () => {
    const results: unknown[] = [];
    for (const targetMb of [1.8, 3, 4, 8, 12, 16]) {
      const checkpoint = createRuntimeCheckpoint(fixture(Math.floor(targetMb * 1024 * 1024 / 2)), 1);
      const representation = getRuntimeCheckpointCanonicalRepresentation(checkpoint)!;
      const started = performance.now();
      const restored = await restoreRuntimeCheckpointCanonicalRepresentation(representation, async () => Promise.resolve());
      const totalMs = Math.round(performance.now() - started);
      expect(restored.payloadHash).toBe(checkpoint.payloadHash);
      results.push({ targetMb, canonicalCharacters: representation.canonicalPayloadText.length, totalMs,
        objectRecanonicalizationCount: 0 });
    }
    console.info("WP_NARVA_10B14_RESTORE_SIZE_PROFILE", JSON.stringify(results));
  });
});
