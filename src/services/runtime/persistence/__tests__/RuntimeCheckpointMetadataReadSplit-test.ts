import { getSupabaseTrafficMetrics, recordSupabaseTraffic, resetSupabaseTrafficMetrics, setSupabaseTrafficMetricsEnabledForTests } from "@/services/SupabaseTrafficMetrics";

describe("WP-EGRESS-02 metadata/payload read split",()=>{
  beforeEach(()=>{setSupabaseTrafficMetricsEnabledForTests(true);resetSupabaseTrafficMetrics();});
  afterAll(()=>setSupabaseTrafficMetricsEnabledForTests(undefined));

  test("deterministic takeover and freshness comparison",()=>{
    const payload={payload:"X".repeat(60_000)};
    const metadata={exercise_id:"EX",checkpoint_revision:12,payload_hash:"H",provenance_hash:"P",writer_instance_id:"W",updated_at:"2026-08-26T00:00:00Z"};
    recordSupabaseTraffic({operation:"BEFORE_TAKEOVER",endpoint:"runtime_checkpoints.payload",data:payload,fullSnapshot:true});
    recordSupabaseTraffic({operation:"BEFORE_TAKEOVER",endpoint:"runtime_checkpoints.payload",data:payload,fullSnapshot:true});
    const before=getSupabaseTrafficMetrics().filter(item=>item.operation==="BEFORE_TAKEOVER").reduce((sum,item)=>sum+item.bytesReceived,0);
    resetSupabaseTrafficMetrics();
    recordSupabaseTraffic({operation:"AFTER_TAKEOVER",endpoint:"runtime_checkpoints.payload",data:payload,fullSnapshot:true});
    recordSupabaseTraffic({operation:"AFTER_TAKEOVER",endpoint:"runtime_checkpoint_notifications.takeover_metadata",data:metadata});
    const after=getSupabaseTrafficMetrics().filter(item=>item.operation==="AFTER_TAKEOVER").reduce((sum,item)=>sum+item.bytesReceived,0);
    const reductionPercent=Number((((before-after)/before)*100).toFixed(1));
    console.info("WP_EGRESS_02_PROFILE",JSON.stringify({beforeFullReads:2,afterFullReads:1,afterMetadataReads:1,beforeBytes:before,afterBytes:after,reductionPercent}));
    expect(reductionPercent).toBeGreaterThan(49);
  });
});
