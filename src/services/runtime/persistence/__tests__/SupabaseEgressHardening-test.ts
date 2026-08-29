import fs from "fs";
import path from "path";

import {
  isCheckpointPublicationBoundary,
  isIdenticalCheckpointPayload,
  ROUTINE_CHECKPOINT_PUBLICATION_MS,
} from "@/services/RuntimeCheckpointSyncService";
import {
  CLOUD_PROJECTION_INTERVAL_MS,
  EXERCISE_DISCOVERY_ACTIVE_FILTER,
  shouldFetchTerminalDiscoveryState,
} from "@/services/CloudSyncService";
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
    expect(source).toContain(".or(EXERCISE_DISCOVERY_ACTIVE_FILTER)");
    expect(source).toContain(".limit(1)");
  });

  test("routine discovery is bounded to active rows and unchanged terminal state is not re-fetched",()=>{
    expect(EXERCISE_DISCOVERY_ACTIVE_FILTER).toContain("lifecycleState.in.(READY,RUNNING,PAUSED)");
    expect(EXERCISE_DISCOVERY_ACTIVE_FILTER).toContain("state.in.(ready,running,paused)");
    const row={exercise_id:"E",revision:7,updated_at:"2026-08-25T08:00:00Z"};
    expect(shouldFetchTerminalDiscoveryState(row)).toBe(true);
    expect(shouldFetchTerminalDiscoveryState(row,{revision:7,updatedAt:row.updated_at})).toBe(false);
    expect(shouldFetchTerminalDiscoveryState({...row,revision:8},{revision:7,updatedAt:row.updated_at})).toBe(true);
  });

  test("routine checkpoint publication remains five seconds while projection publication is coalesced",()=>{
    expect(ROUTINE_CHECKPOINT_PUBLICATION_MS).toBe(5_000);
    expect(CLOUD_PROJECTION_INTERVAL_MS).toBe(60_000);
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
