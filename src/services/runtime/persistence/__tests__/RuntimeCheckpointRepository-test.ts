import { loadCheckpointFreshness, SupabaseRuntimeCheckpointRepository } from "../RuntimeCheckpointRepository";
import { createRuntimeCheckpoint } from "../RuntimeCheckpointAuthorityService";

const sharedState = (time: number) => ({
  exerciseSession: { exerciseId: "E", lifecycleState: "COMPLETED", simulationTimeSec: time },
  patients: [], assignments: [], transfers: [], questions: [], labs: [], imagingStudies: [], orders: [], notes: [],
  scenarioEvents: [], timelineEvents: [], persistedRuntimeStates: [],
}) as never;

function client(result:{data?:unknown;error?:{message:string}}){return {rpc:jest.fn(async()=>({data:result.data??null,error:result.error??null})),from:jest.fn(()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:result.data,error:result.error??null})})})}))} as never;}

describe("WP-44B Supabase repository diagnostics",()=>{
  test("maps a stale backend writer rejection to a stable result",async()=>{
    const repository=new SupabaseRuntimeCheckpointRepository(client({error:{message:"STALE_WRITER"}}));
    await expect(repository.publish({leaseId:"L",exerciseId:"E",writerInstanceId:"W",userId:"U",expiresAt:"x"},4,{checkpointRevision:5} as never))
      .resolves.toEqual({status:"STALE_CHECKPOINT_WRITER",code:"STALE_WRITER"});
  });
  test("maps concurrent expected-revision conflict without exposing SQL",async()=>{
    const repository=new SupabaseRuntimeCheckpointRepository(client({error:{message:"CHECKPOINT_REVISION_CONFLICT detail"}}));
    await expect(repository.publish({leaseId:"L",exerciseId:"E",writerInstanceId:"W",userId:"U",expiresAt:"x"},4,{checkpointRevision:5} as never))
      .resolves.toEqual({status:"REVISION_CONFLICT",code:"CHECKPOINT_REVISION_CONFLICT"});
  });
  test("maps active other writer to read-only acquisition",async()=>{
    const repository=new SupabaseRuntimeCheckpointRepository(client({error:{message:"WRITER_AUTHORITY_HELD"}}));
    await expect(repository.acquireWriter("E","W",4,60)).resolves.toEqual({status:"HELD_BY_OTHER_WRITER",code:"WRITER_AUTHORITY_HELD"});
  });
  test("loads only an active authoritative writer lease",async()=>{
    const repository=new SupabaseRuntimeCheckpointRepository(client({data:{
      lease_id:"L",exercise_id:"E",writer_instance_id:"W",writer_user_id:"U",
      expires_at:new Date(Date.now()+60_000).toISOString(),released_at:null,
    }}));
    await expect(repository.loadWriterLease("E")).resolves.toMatchObject({
      leaseId:"L",exerciseId:"E",writerInstanceId:"W",userId:"U",
    });
  });
  test("publishes through the metadata-only RPC and reconstructs the acknowledged local envelope",async()=>{
    const mockClient=client({data:{checkpoint_revision:5,payload_hash:"H",provenance_hash:"P"}}) as never;
    const repository=new SupabaseRuntimeCheckpointRepository(mockClient);
    const checkpoint={exerciseId:"E",checkpointRevision:5,payloadHash:"H",provenanceHash:"P",payload:{}} as never;
    await expect(repository.publish({leaseId:"L",exerciseId:"E",writerInstanceId:"W",userId:"U",expiresAt:"x"},4,checkpoint))
      .resolves.toEqual({status:"PUBLISHED",checkpoint});
    expect((mockClient as {rpc:jest.Mock}).rpc).toHaveBeenCalledWith("publish_runtime_checkpoint_metadata",expect.any(Object));
  });
  test("rollout without the delta RPC retries the same publication through the existing RPC",async()=>{
    const base=createRuntimeCheckpoint(sharedState(1),4); const checkpoint=createRuntimeCheckpoint(sharedState(2),5);
    const mockClient={rpc:jest.fn()
      .mockResolvedValueOnce({data:null,error:{code:"PGRST202",message:"Could not find publish_runtime_checkpoint_delta"}})
      .mockResolvedValueOnce({data:{checkpoint_revision:5,payload_hash:checkpoint.payloadHash,provenance_hash:checkpoint.provenanceHash},error:null})};
    const repository=new SupabaseRuntimeCheckpointRepository(mockClient as never);
    await expect(repository.publish({leaseId:"L",exerciseId:"E",writerInstanceId:"W",userId:"U",expiresAt:"x"},4,checkpoint,base))
      .resolves.toMatchObject({status:"PUBLISHED"});
    expect(mockClient.rpc.mock.calls.map(call=>call[0])).toEqual(["publish_runtime_checkpoint_delta","publish_runtime_checkpoint_metadata"]);
  });
  test("loads only checkpoint notification metadata for subscription reconciliation",async()=>{
    const mockClient=client({data:{exercise_id:"E",checkpoint_revision:5,payload_hash:"H",provenance_hash:"P",writer_instance_id:"W",updated_at:"2026-08-26T00:00:00Z",checkpoint_bytes:12345}}) as never;
    const repository=new SupabaseRuntimeCheckpointRepository(mockClient);
    await expect(repository.loadLatestMetadata("E")).resolves.toEqual({exerciseId:"E",checkpointRevision:5,payloadHash:"H",provenanceHash:"P",writerInstanceId:"W",updatedAt:"2026-08-26T00:00:00Z",checkpointBytes:12345});
    expect((mockClient as {from:jest.Mock}).from).toHaveBeenCalledWith("runtime_checkpoint_notifications");
  });
  test("loads lightweight delta cost columns without delta payload JSON",async()=>{
    const rows=[{from_revision:4,to_revision:5,base_hash:"B",target_hash:"T",provenance_hash:"P",delta_version:1,persisted_runtime_version:3,payload_bytes:456}];
    const limit=jest.fn(async()=>({data:rows,error:null}));
    const order=jest.fn(()=>({limit})); const lte=jest.fn(()=>({order})); const gte=jest.fn(()=>({lte})); const eq=jest.fn(()=>({gte}));
    const select=jest.fn((columns:string)=>({eq})); const mockClient={from:jest.fn(()=>({select}))};
    const repository=new SupabaseRuntimeCheckpointRepository(mockClient as never);
    await expect(repository.loadDeltaMetadata("E",4,5,9)).resolves.toEqual([{
      fromRevision:4,toRevision:5,baseHash:"B",targetHash:"T",provenanceHash:"P",deltaVersion:1,persistedRuntimeVersion:3,payloadBytes:456,
    }]);
    expect(select).toHaveBeenCalledWith("from_revision,to_revision,base_hash,target_hash,provenance_hash,delta_version,persisted_runtime_version,payload_bytes");
    expect(select.mock.calls[0][0]).not.toContain("delta_payload");
  });
  test("freshness decisions avoid payload reads when atomic metadata exists",async()=>{
    const repository={loadLatestMetadata:jest.fn(async()=>({exerciseId:"E",checkpointRevision:5,payloadHash:"H",provenanceHash:"P",writerInstanceId:"W"})),loadLatest:jest.fn()};
    await expect(loadCheckpointFreshness(repository,"E","takeover")).resolves.toMatchObject({checkpointRevision:5,payloadHash:"H"});
    expect(repository.loadLatest).not.toHaveBeenCalled();
  });
  test("missing metadata falls back to the authoritative payload",async()=>{
    const repository={loadLatestMetadata:jest.fn(async()=>undefined),loadLatest:jest.fn(async()=>({exerciseId:"E",checkpointRevision:5,payloadHash:"H",provenanceHash:"P"}))};
    await expect(loadCheckpointFreshness(repository as never,"E","recovery")).resolves.toMatchObject({checkpointRevision:5,payloadHash:"H"});
    expect(repository.loadLatest).toHaveBeenCalledWith("E","runtime_checkpoints.recovery_fallback_payload");
  });
  test("malformed or rollout-unavailable metadata fails safe through payload fallback",async()=>{
    const checkpoint={exerciseId:"E",checkpointRevision:5,payloadHash:"H",provenanceHash:"P"};
    const malformed={loadLatestMetadata:jest.fn(async()=>undefined),loadLatest:jest.fn(async()=>checkpoint)};
    const unavailable={loadLatestMetadata:jest.fn(async()=>{throw new Error("AUTHORITY_UNAVAILABLE");}),loadLatest:jest.fn(async()=>checkpoint)};
    await expect(loadCheckpointFreshness(malformed as never,"E","cas")).resolves.toMatchObject(checkpoint);
    await expect(loadCheckpointFreshness(unavailable as never,"E","cas")).resolves.toMatchObject(checkpoint);
    expect(malformed.loadLatest).toHaveBeenCalledTimes(1); expect(unavailable.loadLatest).toHaveBeenCalledTimes(1);
  });
});
