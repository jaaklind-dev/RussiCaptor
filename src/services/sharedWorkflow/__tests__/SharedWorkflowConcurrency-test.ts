import { InMemorySharedWorkflowGateway } from "../InMemorySharedWorkflowGateway";
import { getSharedWorkflowConflictMetrics, resetSharedWorkflowConflictMetrics, setSharedWorkflowConnectivity,
  setSharedWorkflowGateway, submitSharedWorkflowMutation, type SharedWorkflowMutationRequest } from "../SharedWorkflowMutationService";

type Actor={userId:string;role:"CM"|"EXCON";exerciseIds:readonly string[]|"GLOBAL"};
let actor:Actor;
const state=(extras:Record<string,unknown>={})=>Object.freeze({notes:[],timelineEvents:[],interventions:[],medicationAdministrations:[],vitalSigns:[],...extras});
const request=(overrides:Partial<SharedWorkflowMutationRequest>={}):SharedWorkflowMutationRequest=>({
  exerciseId:"EX-A",patientId:"P-1",commandId:"CMD-1",kind:"MUTABLE",expectedRevision:0,
  expectedOwnerUserId:"CM-A",nextOwnerUserId:"CM-A",state:state({status:"Active"}),...overrides,
});

describe("WP-NEXT-03 conflict-safe multi-CM workflow",()=>{
  beforeEach(()=>{actor={userId:"CM-A",role:"CM",exerciseIds:["EX-A"]};resetSharedWorkflowConflictMetrics();setSharedWorkflowConnectivity(true);});
  afterEach(()=>setSharedWorkflowGateway(undefined));

  it("allows exactly one simultaneous patient claim",async()=>{
    const local=new InMemorySharedWorkflowGateway(()=>actor); local.seed("EX-A","P-1",state());
    const a=local.submit(request({commandId:"CLAIM-A",kind:"CLAIM",expectedOwnerUserId:undefined,nextOwnerUserId:"CM-A"}));
    actor={userId:"CM-B",role:"CM",exerciseIds:["EX-A"]};
    const b=local.submit(request({commandId:"CLAIM-B",kind:"CLAIM",expectedOwnerUserId:undefined,nextOwnerUserId:"CM-B"}));
    const results=await Promise.all([a,b]); expect(results.map(item=>item.status).sort()).toEqual(["ALREADY_OWNED","APPLIED"]);
    expect(local.read("EX-A","P-1")?.ownerUserId).toBe("CM-A");
  });

  it("does not let a first mutable request manufacture patient ownership",async()=>{
    const local=new InMemorySharedWorkflowGateway(()=>actor);
    expect((await local.submit(request({commandId:"SPOOF"}))).status).toBe("OWNERSHIP_CHANGED");
    expect(local.read("EX-A","P-1")?.ownerUserId).toBeUndefined();
  });

  it("rejects claim versus transfer from a stale base",async()=>{
    const local=new InMemorySharedWorkflowGateway(()=>actor);local.seed("EX-A","P-1",state(),"CM-A",1);
    expect((await local.submit(request({commandId:"TRANSFER",kind:"TRANSFER",expectedRevision:1,nextOwnerUserId:"CM-B"}))).status).toBe("APPLIED");
    actor={userId:"CM-B",role:"CM",exerciseIds:["EX-A"]};
    expect((await local.submit(request({commandId:"CLAIM",kind:"CLAIM",expectedRevision:1,expectedOwnerUserId:undefined,nextOwnerUserId:"CM-B"}))).status).toBe("ALREADY_OWNED");
  });

  it("rejects former owner mutation after transfer",async()=>{
    const local=new InMemorySharedWorkflowGateway(()=>actor);local.seed("EX-A","P-1",state(),"CM-A",2);
    await local.submit(request({commandId:"TRANSFER",kind:"TRANSFER",expectedRevision:2,nextOwnerUserId:"CM-B"}));
    expect((await local.submit(request({commandId:"STALE",kind:"MUTABLE",expectedRevision:3,expectedOwnerUserId:"CM-A",nextOwnerUserId:"CM-A"}))).status).toBe("OWNERSHIP_CHANGED");
  });

  it("serializes release and reacquire",async()=>{
    const local=new InMemorySharedWorkflowGateway(()=>actor);local.seed("EX-A","P-1",state(),"CM-A",1);
    expect((await local.submit(request({commandId:"RELEASE",kind:"RELEASE",expectedRevision:1,nextOwnerUserId:undefined}))).status).toBe("APPLIED");
    actor={userId:"CM-B",role:"CM",exerciseIds:["EX-A"]};
    expect((await local.submit(request({commandId:"REACQUIRE",kind:"REACQUIRE",expectedRevision:2,expectedOwnerUserId:undefined,nextOwnerUserId:"CM-B"}))).status).toBe("APPLIED");
  });

  it("suppresses duplicate action retry",async()=>{
    const local=new InMemorySharedWorkflowGateway(()=>actor);local.seed("EX-A","P-1",state(),"CM-A",0);
    const req=request({commandId:"NOTE-1",kind:"APPEND",state:state({notes:[{id:"N-1"}]})});
    expect((await local.submit(req)).status).toBe("APPLIED");expect((await local.submit(req)).status).toBe("IDEMPOTENT");
    expect((local.read("EX-A","P-1")?.state.notes as unknown[]).length).toBe(1);
  });

  it("rejects the same idempotency key from another actor",async()=>{
    const local=new InMemorySharedWorkflowGateway(()=>actor);local.seed("EX-A","P-1",state(),"CM-A",0);
    const req=request({commandId:"SAME",kind:"APPEND",state:state({notes:[{id:"N-1"}]})});await local.submit(req);
    actor={userId:"CM-B",role:"EXCON",exerciseIds:["EX-A"]};await expect(local.submit(req)).rejects.toThrow("IDEMPOTENCY_KEY_REUSE");
  });

  it("merges concurrent append-only actions without loss",async()=>{
    const local=new InMemorySharedWorkflowGateway(()=>actor);local.seed("EX-A","P-1",state(),"CM-A",0);
    await local.submit(request({commandId:"N-1",kind:"APPEND",state:state({notes:[{id:"N-1"}]})}));
    await local.submit(request({commandId:"V-1",kind:"APPEND",expectedRevision:0,state:state({vitalSigns:[{id:"V-1"}]})}));
    const head=local.read("EX-A","P-1")!;expect((head.state.notes as unknown[]).length).toBe(1);expect((head.state.vitalSigns as unknown[]).length).toBe(1);
  });

  it("does not conflict across different patients",async()=>{
    const local=new InMemorySharedWorkflowGateway(()=>actor);local.seed("EX-A","P-1",state(),"CM-A");local.seed("EX-A","P-2",state(),"CM-A");
    const results=await Promise.all([local.submit(request({commandId:"P1"})),local.submit(request({patientId:"P-2",commandId:"P2"}))]);
    expect(results.map(item=>item.status)).toEqual(["APPLIED","APPLIED"]);
  });

  it("rejects concurrent mutable updates to the same patient",async()=>{
    const local=new InMemorySharedWorkflowGateway(()=>actor);local.seed("EX-A","P-1",state(),"CM-A");
    expect((await local.submit(request({commandId:"M1",state:state({location:"A"})}))).status).toBe("APPLIED");
    expect((await local.submit(request({commandId:"M2",state:state({location:"B"})}))).status).toBe("STALE_VERSION");
    expect(local.read("EX-A","P-1")?.state.location).toBe("A");
  });

  it("allows a refreshed retry after stale rejection",async()=>{
    const local=new InMemorySharedWorkflowGateway(()=>actor);local.seed("EX-A","P-1",state(),"CM-A");
    await local.submit(request({commandId:"FIRST"}));
    expect((await local.submit(request({commandId:"STALE"}))).status).toBe("STALE_VERSION");
    expect((await local.submit(request({commandId:"RETRY",expectedRevision:1}))).status).toBe("APPLIED");
  });

  it("denies a reconnecting former owner",async()=>{
    const local=new InMemorySharedWorkflowGateway(()=>actor);local.seed("EX-A","P-1",state(),"CM-B",4);
    expect((await local.submit(request({commandId:"OFFLINE",expectedRevision:4,expectedOwnerUserId:"CM-A"}))).status).toBe("OWNERSHIP_CHANGED");
  });

  it("denies an authenticated CM in the wrong exercise",async()=>{
    const local=new InMemorySharedWorkflowGateway(()=>actor);local.seed("EX-B","P-1",state(),"CM-A");
    expect((await local.submit(request({exerciseId:"EX-B"}))).status).toBe("AUTHORIZATION_DENIED");
  });

  it("preserves EXCON control without granting CM ownership implicitly",async()=>{
    actor={userId:"EXCON",role:"EXCON",exerciseIds:["EX-A"]};const local=new InMemorySharedWorkflowGateway(()=>actor);local.seed("EX-A","P-1",state(),"CM-A");
    expect((await local.submit(request({commandId:"EXCON-M",nextOwnerUserId:"CM-A"}))).status).toBe("APPLIED");
    expect(local.read("EX-A","P-1")?.ownerUserId).toBe("CM-A");
  });

  it("attributes command effects to the authenticated actor",async()=>{
    const local=new InMemorySharedWorkflowGateway(()=>actor);local.seed("EX-A","P-1",state(),"CM-A");
    const applied=await local.submit(request({commandId:"ATTR"}));expect(applied.status).toBe("APPLIED");
    actor={userId:"CM-B",role:"EXCON",exerciseIds:["EX-A"]};await expect(local.submit(request({commandId:"ATTR"}))).rejects.toThrow("IDEMPOTENCY_KEY_REUSE");
  });

  it("keeps legacy patient payload fields readable",async()=>{
    const legacy=state({legacyField:{nested:true}});const local=new InMemorySharedWorkflowGateway(()=>actor);local.seed("EX-A","P-1",legacy,"CM-A");
    const applied=await local.submit(request({commandId:"LEGACY",kind:"APPEND",state:state({notes:[{id:"N"}]})}));
    expect(applied.state?.legacyField).toEqual({nested:true});
  });

  it("records aggregate conflict, reconnect and successful retry metrics",async()=>{
    const local=new InMemorySharedWorkflowGateway(()=>actor);local.seed("EX-A","P-1",state(),"CM-A",1);setSharedWorkflowGateway(local);
    expect((await submitSharedWorkflowMutation(request({commandId:"STALE-METRIC",expectedRevision:0}))).status).toBe("STALE_VERSION");
    setSharedWorkflowConnectivity(false);setSharedWorkflowConnectivity(true);
    expect((await submitSharedWorkflowMutation(request({commandId:"RETRY-METRIC",expectedRevision:1}))).status).toBe("APPLIED");
    expect(getSharedWorkflowConflictMetrics()).toMatchObject({staleWriteRejections:1,concurrentMutations:1,
      reconnectConflictResolutions:1,successfulRetries:1});
  });
});
