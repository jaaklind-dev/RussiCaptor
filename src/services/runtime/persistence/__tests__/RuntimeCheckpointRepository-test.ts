import { SupabaseRuntimeCheckpointRepository } from "../RuntimeCheckpointRepository";

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
});
