import fs from "fs";
import path from "path";

import {
  isCheckpointPublicationBoundary,
  isIdenticalCheckpointPayload,
  ROUTINE_CHECKPOINT_PUBLICATION_MS,
} from "@/services/RuntimeCheckpointSyncService";
import { CLOUD_PROJECTION_INTERVAL_MS } from "@/services/CloudSyncService";
import type { RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";

function checkpoint(overrides: Partial<SharedExerciseState> = {}, hash = "H"): RuntimeCheckpointEnvelope<SharedExerciseState> {
  const payload = {
    exerciseSession: { exerciseId: "E", lifecycleState: "RUNNING", simulationTimeSec: 10 },
    patients: [], assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [],
    orders: [], notes: [], scenarioEvents: [], timelineEvents: [],
    ...overrides,
  } as SharedExerciseState;
  return { envelopeVersion: 1, exerciseId: "E", checkpointRevision: 1,
    persistedRuntimeVersion: 1, payload, payloadHash: hash, provenanceHash: "P" };
}

describe("WP-47A Supabase egress hardening",()=>{
  test("exercise discovery and write acknowledgement never request full rows",()=>{
    const source=fs.readFileSync(path.join(process.cwd(),"src/services/CloudSyncService.ts"),"utf8");
    expect(source).toContain("exercise_session:state->exerciseSession");
    expect(source).toContain('.select("exercise_id,revision,updated_at")');
    expect(source).not.toMatch(/from\("exercise_states"\)\s*\n\s*\.select\(\)/);
    expect(source).not.toContain('table: "exercise_states"');
  });

  test("routine publication is bounded to five seconds and duplicate payloads are suppressed",()=>{
    expect(ROUTINE_CHECKPOINT_PUBLICATION_MS).toBe(5_000);
    expect(CLOUD_PROJECTION_INTERVAL_MS).toBe(5_000);
    expect(isIdenticalCheckpointPayload(checkpoint({},"same"),checkpoint({},"same"))).toBe(true);
    expect(isIdenticalCheckpointPayload(checkpoint({},"one"),checkpoint({},"two"))).toBe(false);
  });

  test("clinical evidence and lifecycle transitions remain immediate boundaries",()=>{
    const before=checkpoint();
    expect(isCheckpointPublicationBoundary(before,checkpoint({timelineEvents:[{} as never]},"T"))).toBe(true);
    expect(isCheckpointPublicationBoundary(before,checkpoint({interventions:[{} as never]},"I"))).toBe(true);
    expect(isCheckpointPublicationBoundary(before,checkpoint({exerciseSession:{exerciseId:"E",lifecycleState:"PAUSED",simulationTimeSec:10} as never},"L"))).toBe(true);
    expect(isCheckpointPublicationBoundary(before,checkpoint({exerciseSession:{exerciseId:"E",lifecycleState:"RUNNING",simulationTimeSec:11} as never},"C"))).toBe(false);
  });
});
