import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { createRuntimeCheckpoint } from "@/services/runtime/persistence/RuntimeCheckpointAuthorityService";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";
import { canPublishProjectionWithPackageAuthority, projectionPackageAuthority } from "../ExerciseProjectionPackageAuthority";

function state(packageId = "PACKAGE-A", lifecycleState = "RUNNING"): SharedExerciseState {
  const exerciseId = "EX-1";
  const payload = { simulationTimeSec: 1 };
  return {
    exerciseSession: { exerciseId, lifecycleState, simulationTimeSec: 1, version: 7 } as never,
    exercisePackageReference: { packageId, packageVersion: "1.0.0" },
    patients: [{ id: "PT-1", name: "Patient" } as never],
    assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [], orders: [], notes: [], scenarioEvents: [], timelineEvents: [],
    persistedRuntimeStates: [{ schemaVersion: 1, provenance: { exerciseId, patientId: "PT-1", packageId, packageVersion: "1.0.0", packageHash: "pkg", definitionHash: "def", moduleCompositionHash: "modules" }, capturedAtSimulationTimeSec: 1, payload, payloadHash: sha256Text(stableJson(payload)) } as never],
  };
}

describe("active projection package authority", () => {
  test("rejects the proven stale-package projection against active remote identity", () => {
    expect(canPublishProjectionWithPackageAuthority(
      state("russicaptor.botulism-johvi"),
      projectionPackageAuthority(state("russicaptor.clinical-sanity-reference")),
      undefined,
    )).toBe(false);
  });

  test("rejects a candidate that disagrees with the validated checkpoint even without discovery", () => {
    const checkpoint = createRuntimeCheckpoint(state("russicaptor.clinical-sanity-reference"), 18);
    expect(canPublishProjectionWithPackageAuthority(state("russicaptor.botulism-johvi"), undefined, checkpoint)).toBe(false);
  });

  test("allows exact identity and a new READY projection without prior authority", () => {
    const candidate = state("russicaptor.clinical-sanity-reference");
    expect(canPublishProjectionWithPackageAuthority(candidate, projectionPackageAuthority(candidate), createRuntimeCheckpoint(candidate, 18))).toBe(true);
    expect(canPublishProjectionWithPackageAuthority(state("PACKAGE-NEW", "READY"), undefined, undefined)).toBe(true);
  });
});
