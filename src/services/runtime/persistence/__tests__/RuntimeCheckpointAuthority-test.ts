import type { SharedExerciseState } from "@/services/StatePersistenceService";
import { createRuntimeCheckpoint, isValidRuntimeCheckpoint, isValidRuntimeCheckpointAsync, localRuntimeCheckpointStore, resolveAgainstValidatedLocalCheckpoint, resolveAuthoritativeCheckpoint, resolveAuthoritativeCheckpointAsync, resolveSubscribedCheckpoint } from "../RuntimeCheckpointAuthorityService";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";
import { assertRuntimeCheckpointClockConsistency, runtimeRestoreSource } from "@/services/StatePersistenceService";

function state(exerciseId="EX-1", patientIds=["PT-1"]):SharedExerciseState {
  const payload = {};
  return {
    exerciseSession:{ exerciseId, lifecycleState:"RUNNING", simulationTimeSec:12, startedAtSimulationSec:0 } as never,
    patients:patientIds.map(id=>({id,name:id} as never)), assignments:[],transfers:[],questions:[],labs:[],imagingStudies:[],orders:[],notes:[],scenarioEvents:[],timelineEvents:[],
    persistedRuntimeStates:patientIds.map(patientId=>({schemaVersion:1,provenance:{exerciseId,patientId,packageId:"PKG",packageVersion:"1",packageHash:"pkg",definitionHash:"def",moduleCompositionHash:"modules"},capturedAtSimulationTimeSec:12,payload,payloadHash:sha256Text(stableJson(payload))} as never)),
  };
}

describe("WP-44B checkpoint authority resolver",()=>{
  test("higher valid revision wins independent of arrival order",()=>{
    const older=createRuntimeCheckpoint(state(),10); const newer=createRuntimeCheckpoint(state("EX-1",["PT-1","PT-2"]),12);
    expect(resolveAuthoritativeCheckpoint(newer,older)).toMatchObject({status:"LOCAL",checkpoint:{checkpointRevision:12}});
    expect(resolveAuthoritativeCheckpoint(older,newer)).toMatchObject({status:"REMOTE",checkpoint:{checkpointRevision:12}});
  });
  test("same revision and hash is equivalent",()=>{
    const checkpoint=createRuntimeCheckpoint(state(),12);
    expect(Object.isFrozen(checkpoint)).toBe(true);
    expect(Object.isFrozen(checkpoint.payload)).toBe(true);
    expect(Object.isFrozen(checkpoint.payload.persistedRuntimeStates?.[0]?.payload)).toBe(true);
    expect(resolveAuthoritativeCheckpoint(checkpoint,structuredClone(checkpoint))).toMatchObject({status:"EQUIVALENT"});
  });
  test("validated local equivalent retains the local canonical payload",()=>{
    const checkpoint=createRuntimeCheckpoint(state(),12);
    const resolved=resolveAgainstValidatedLocalCheckpoint(checkpoint,structuredClone(checkpoint));
    expect(resolved).toEqual({status:"EQUIVALENT",checkpoint});
    expect(resolved.status === "EQUIVALENT" && resolved.checkpoint).toBe(checkpoint);
  });
  test("published acknowledgement transfers validation only for the exact immutable submitted payload", async()=>{
    const submitted=createRuntimeCheckpoint(state(),12);
    await localRuntimeCheckpointStore.restoreAsync(submitted,async()=>undefined);
    const acknowledged=Object.freeze({...submitted});
    expect(()=>localRuntimeCheckpointStore.acceptPublishedAcknowledgement(submitted,acknowledged)).not.toThrow();
    expect(localRuntimeCheckpointStore.get()).toBe(acknowledged);
    const cloned=structuredClone(submitted);
    expect(()=>localRuntimeCheckpointStore.acceptPublishedAcknowledgement(submitted,cloned)).toThrow("CHECKPOINT_ACKNOWLEDGEMENT_INVALID");
    expect(()=>localRuntimeCheckpointStore.acceptPublishedAcknowledgement(submitted,Object.freeze({...submitted,payloadHash:"corrupt"}))).toThrow("CHECKPOINT_ACKNOWLEDGEMENT_INVALID");
    localRuntimeCheckpointStore.restore(undefined);
  });
  test("same revision with different valid payload fails closed",()=>{
    const a=createRuntimeCheckpoint(state("EX-1",["PT-A"]),12); const b=createRuntimeCheckpoint(state("EX-1",["PT-B"]),12);
    expect(resolveAuthoritativeCheckpoint(a,b)).toEqual({status:"CONFLICT",code:"CHECKPOINT_REVISION_DIVERGENCE"});
  });
  test("lease-free reader repairs same-revision divergence from durable subscription",()=>{
    const local=createRuntimeCheckpoint(state("EX-1",["PT-A"]),12); const remote=createRuntimeCheckpoint(state("EX-1",["PT-B"]),12);
    expect(resolveSubscribedCheckpoint(local,remote,false)).toEqual({status:"REMOTE",checkpoint:remote});
  });
  test("lease-free reader replaces a historically inflated local-only revision with durable authority",()=>{
    const inflatedReaderCache=createRuntimeCheckpoint(state("EX-1",["PT-A"]),27);
    const durableWriterCheckpoint=createRuntimeCheckpoint(state("EX-1",["PT-B"]),26);
    expect(resolveSubscribedCheckpoint(inflatedReaderCache,durableWriterCheckpoint,false))
      .toEqual({status:"REMOTE",checkpoint:durableWriterCheckpoint});
  });
  test("writer keeps same-revision subscription divergence fail-closed",()=>{
    const local=createRuntimeCheckpoint(state("EX-1",["PT-A"]),12); const remote=createRuntimeCheckpoint(state("EX-1",["PT-B"]),12);
    expect(resolveSubscribedCheckpoint(local,remote,true)).toEqual({status:"CONFLICT",code:"CHECKPOINT_REVISION_DIVERGENCE"});
  });
  test("invalid higher revision cannot replace valid lower revision",()=>{
    const valid=createRuntimeCheckpoint(state(),10); const corrupt={...createRuntimeCheckpoint(state(),13),payloadHash:"corrupt"};
    expect(isValidRuntimeCheckpoint(corrupt)).toBe(false);
    expect(resolveAuthoritativeCheckpoint(valid,corrupt)).toMatchObject({status:"LOCAL",checkpoint:{checkpointRevision:10}});
  });
  test("inactive checkpoint still validates every Runtime payload and provenance",()=>{
    const inactive=state();
    inactive.exerciseSession={...inactive.exerciseSession,lifecycleState:"COMPLETED"} as never;
    const valid=createRuntimeCheckpoint(inactive,10);
    const corruptPayload={...valid,payload:{...valid.payload,persistedRuntimeStates:valid.payload.persistedRuntimeStates?.map(item=>({...item,payloadHash:"corrupt"}))}};
    const foreignProvenance={...valid,payload:{...valid.payload,persistedRuntimeStates:valid.payload.persistedRuntimeStates?.map(item=>({...item,provenance:{...item.provenance,exerciseId:"OTHER"}}))}};
    expect(isValidRuntimeCheckpoint(corruptPayload)).toBe(false);
    expect(isValidRuntimeCheckpoint(foreignProvenance)).toBe(false);
  });
  test("yielding validation accepts the same canonical checkpoint and marks only its exact identity", async()=>{
    const checkpoint=createRuntimeCheckpoint(state(),12);
    const deserialized=structuredClone(checkpoint);
    const yieldControl=jest.fn(async()=>Promise.resolve());
    await expect(isValidRuntimeCheckpointAsync(deserialized,yieldControl)).resolves.toBe(true);
    expect(yieldControl).toHaveBeenCalled();
    expect(isValidRuntimeCheckpoint(deserialized)).toBe(true);
    await expect(isValidRuntimeCheckpointAsync({...deserialized,payloadHash:"corrupt"},yieldControl)).resolves.toBe(false);
  });
  test("cooperative remote resolution preserves synchronous selection and fail-closed validation", async()=>{
    const local=createRuntimeCheckpoint(state("EX-1",["PT-1","PT-2"]),142);
    const remote=structuredClone(createRuntimeCheckpoint(state("EX-1"),141));
    const yieldControl=jest.fn(async()=>Promise.resolve());
    await expect(resolveAuthoritativeCheckpointAsync(local,remote,yieldControl))
      .resolves.toEqual(resolveAuthoritativeCheckpoint(local,remote));
    const corrupt={...structuredClone(remote),payloadHash:"corrupt"};
    await expect(resolveAuthoritativeCheckpointAsync(local,corrupt,yieldControl))
      .resolves.toEqual(resolveAuthoritativeCheckpoint(local,corrupt));
  });
  test("envelope-identical startup publication reuses only the validated local object", async()=>{
    const local=structuredClone(createRuntimeCheckpoint(state(),12));
    const remote=structuredClone(local);
    const yieldControl=jest.fn(async()=>Promise.resolve());
    await expect(resolveAuthoritativeCheckpointAsync(local,remote,yieldControl))
      .resolves.toEqual({status:"EQUIVALENT",checkpoint:local});
    const altered={...structuredClone(remote),payload:{...remote.payload,notes:[{id:"ALTERED"} as never]}};
    await expect(resolveAuthoritativeCheckpointAsync(local,altered,yieldControl))
      .resolves.toEqual({status:"EQUIVALENT",checkpoint:local});
    expect(isValidRuntimeCheckpoint(altered)).toBe(false);
  });
  test("validated same-exercise checkpoint is the Runtime source; other cases keep the fail-closed fallback",()=>{
    const local=state("EX-1"); const checkpoint=createRuntimeCheckpoint(state("EX-1"),12);
    expect(runtimeRestoreSource(local,checkpoint)).toBe(checkpoint.payload);
    expect(runtimeRestoreSource(local,{...checkpoint,exerciseId:"OTHER"})).toBe(local);
    expect(runtimeRestoreSource(local,undefined)).toBe(local);
  });
  test("different exercise identities fail closed",()=>{
    expect(resolveAuthoritativeCheckpoint(createRuntimeCheckpoint(state("A"),1),createRuntimeCheckpoint(state("B"),2)))
      .toEqual({status:"CONFLICT",code:"REMOTE_SYNC_CONFLICT"});
  });
  test("active checkpoint requires materialized patients and persisted Runtime",()=>{
    const missing={...state(),patients:[],persistedRuntimeStates:[]};
    expect(()=>createRuntimeCheckpoint(missing,1)).toThrow("ACTIVE_RUNTIME_PERSISTENCE_MISSING");
  });
  test("active checkpoint rejects missing, duplicate and foreign Runtime provenance",()=>{
    const valid=state("EX-1",["PT-1","PT-2"]); const first=valid.persistedRuntimeStates![0];
    expect(()=>createRuntimeCheckpoint({...valid,persistedRuntimeStates:[first]},1)).not.toThrow();
    expect(()=>createRuntimeCheckpoint({...valid,persistedRuntimeStates:[first,first]},1)).toThrow("ACTIVE_RUNTIME_PERSISTENCE_MISSING");
    expect(()=>createRuntimeCheckpoint({...valid,persistedRuntimeStates:[{...first,provenance:{...first.provenance,exerciseId:"OTHER"}}]},1)).toThrow("ACTIVE_RUNTIME_PERSISTENCE_MISSING");
  });
  test("newer authoritative clock is validated internally, not against stale local clock",()=>{
    const stale=state();
    const remote=state();
    remote.exerciseSession={...remote.exerciseSession,simulationTimeSec:24} as never;
    remote.persistedRuntimeStates=remote.persistedRuntimeStates?.map(item=>({...item,capturedAtSimulationTimeSec:24,
      payload:{...item.payload,simulationTimeSec:24},payloadHash:sha256Text(stableJson({...item.payload,simulationTimeSec:24}))}));
    expect((stale.exerciseSession as {simulationTimeSec:number}).simulationTimeSec).toBe(12);
    expect(()=>assertRuntimeCheckpointClockConsistency(remote)).not.toThrow();
  });
  test("internally inconsistent authoritative clock remains fail-closed",()=>{
    const corrupt=state();
    corrupt.exerciseSession={...corrupt.exerciseSession,simulationTimeSec:24} as never;
    expect(()=>assertRuntimeCheckpointClockConsistency(corrupt)).toThrow("RUNTIME_CHECKPOINT_CLOCK_MISMATCH");
  });
});
