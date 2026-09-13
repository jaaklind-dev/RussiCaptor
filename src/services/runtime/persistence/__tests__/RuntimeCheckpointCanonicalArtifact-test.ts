import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";
import {
  createRuntimeCheckpoint,
  extractCanonicalRuntimePayloadTexts,
  getRuntimeCheckpointCanonicalRepresentation,
  isValidRuntimeCheckpoint,
  restoreRuntimeCheckpointCanonicalRepresentation,
} from "../RuntimeCheckpointAuthorityService";

const runtimePayload = { simulationTimeSec: 2622, events: [{ id: "A", value: "õ🚀" }], state: { held: true } };
const state = (): SharedExerciseState => ({
  exerciseSession: { exerciseId: "EX-CANONICAL", lifecycleState: "RUNNING", simulationTimeSec: 2622 } as never,
  patients: [{ id: "PT-1", name: "Test" } as never], assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [],
  orders: [], notes: [], scenarioEvents: [], timelineEvents: [],
  persistedRuntimeStates: [{
    schemaVersion: 1,
    provenance: { exerciseId: "EX-CANONICAL", patientId: "PT-1", packageId: "PKG", packageVersion: "1",
      packageHash: "pkg", definitionHash: "def", moduleCompositionHash: "modules" },
    capturedAtSimulationTimeSec: 2622,
    payload: runtimePayload,
    payloadHash: sha256Text(stableJson(runtimePayload)),
  } as never],
});

const yieldControl = async () => Promise.resolve();

describe("WP-NARVA-10B14 persisted canonical checkpoint", () => {
  test("writer representation restores with zero object recanonicalization and exact inner bytes", async () => {
    const checkpoint = createRuntimeCheckpoint(state(), 26);
    const representation = getRuntimeCheckpointCanonicalRepresentation(checkpoint)!;
    expect(representation.canonicalPayloadText).toBe(stableJson(checkpoint.payload));
    expect(extractCanonicalRuntimePayloadTexts(representation.canonicalPayloadText)).toEqual([stableJson(runtimePayload)]);
    const restored = await restoreRuntimeCheckpointCanonicalRepresentation(representation, yieldControl);
    expect(restored).toEqual(checkpoint);
    expect(isValidRuntimeCheckpoint(restored)).toBe(true);
    expect(getRuntimeCheckpointCanonicalRepresentation(restored)).toBe(representation);
  });

  test("outer text alteration, malformed text, identity substitution and truncation fail closed", async () => {
    const representation = getRuntimeCheckpointCanonicalRepresentation(createRuntimeCheckpoint(state(), 26))!;
    await expect(restoreRuntimeCheckpointCanonicalRepresentation({ ...representation,
      canonicalPayloadText: representation.canonicalPayloadText.replace("2622", "2623") }, yieldControl))
      .rejects.toThrow("CHECKPOINT_HASH_INVALID");
    await expect(restoreRuntimeCheckpointCanonicalRepresentation({ ...representation,
      canonicalPayloadText: "{" }, yieldControl)).rejects.toThrow("CHECKPOINT_HASH_INVALID");
    await expect(restoreRuntimeCheckpointCanonicalRepresentation({ ...representation,
      exerciseId: "EX-OTHER" }, yieldControl)).rejects.toThrow("CHECKPOINT_PROVENANCE_INVALID");
    await expect(restoreRuntimeCheckpointCanonicalRepresentation({ ...representation,
      canonicalPayloadText: representation.canonicalPayloadText.slice(0, -1) }, yieldControl))
      .rejects.toThrow("CHECKPOINT_HASH_INVALID");
  });

  test("independently valid outer text with an invalid inner Runtime hash is rejected", async () => {
    const checkpoint = createRuntimeCheckpoint(state(), 26);
    const altered = structuredClone(checkpoint.payload);
    ((altered.persistedRuntimeStates![0].payload as unknown) as typeof runtimePayload).simulationTimeSec = 2623;
    const canonicalPayloadText = stableJson(altered);
    const representation = getRuntimeCheckpointCanonicalRepresentation(checkpoint)!;
    await expect(restoreRuntimeCheckpointCanonicalRepresentation({
      ...representation, canonicalPayloadText, payloadHash: sha256Text(canonicalPayloadText),
    }, yieldControl)).rejects.toThrow("RUNTIME_PAYLOAD_HASH_MISMATCH");
  });

  test("runtime extraction preserves optional, integer-like and Unicode canonical bytes", () => {
    const payload = { "10": 10, "2": 2, optional: undefined, empty: "", unicode: "Жõ🚀", nested: [null, false, 0] };
    const initial = state();
    const input = { ...initial, persistedRuntimeStates: [{ ...initial.persistedRuntimeStates![0], payload,
      payloadHash: sha256Text(stableJson(payload)) } as never] } as SharedExerciseState;
    const representation = getRuntimeCheckpointCanonicalRepresentation(createRuntimeCheckpoint(input, 27))!;
    expect(extractCanonicalRuntimePayloadTexts(representation.canonicalPayloadText)).toEqual([stableJson(payload)]);
  });
});
