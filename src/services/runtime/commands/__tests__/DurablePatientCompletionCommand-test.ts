import type { RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import type { RuntimePatientCommandSubmission } from "@/models/RuntimePatientCommand";
import { findPatientById, resetPatients, setPatientStatus } from "@/repositories/PatientRepository";
import { getExerciseSession, startExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { addScenarioEvent, getResolvedScenarioEvents } from "@/repositories/ScenarioRepository";
import { clearTimelineEvents, getTimelineEvents } from "@/repositories/TimelineRepository";
import { assignPatientToMe, clearAssignments, getAllActivePatientAssignments, getPatientAssignment,
  restoreAuthoritativePatientOwnershipProjection } from "@/services/AssignmentRepository";
import { resetExercise } from "@/services/ExerciseResetService";
import { PatientTransportEngine } from "@/services/runtime/PatientTransportEngine";
import { materializePatientCompletion, materializePatientCompletionAuthoritatively } from
  "@/services/runtime/exercise/PatientCompletionMaterializationService";
import { setCurrentCaseManager } from "@/services/CurrentUserService";
import { capturePatientSharedWorkflowState, restoreAuthoritativePatientSharedWorkflowState,
  type PatientSharedWorkflowState } from "@/services/sharedWorkflow/PatientSharedWorkflowState";
import { InMemorySharedWorkflowGateway } from "@/services/sharedWorkflow/InMemorySharedWorkflowGateway";
import { getSharedWorkflowHead, observeSharedWorkflowHead, resetSharedWorkflowConflictMetrics,
  setSharedWorkflowConnectivity, setSharedWorkflowGateway } from
  "@/services/sharedWorkflow/SharedWorkflowMutationService";
import { InMemoryRuntimePatientCommandGateway, type RuntimeCommandActor } from
  "../InMemoryRuntimePatientCommandGateway";
import { materializeRuntimePatientCommand } from "../RuntimePatientCommandMaterializer";
import { RuntimePatientCommandConsumer } from "../RuntimePatientCommandService";
import { resetRuntimePatientCommandCursor, restoreRuntimePatientCommandCursor } from
  "../RuntimePatientCommandCursor";

const exerciseId="demo"; const patientId="PT-001";
const lease:RuntimeWriterLease=Object.freeze({leaseId:"LEASE",exerciseId,writerInstanceId:"WRITER",
  userId:"EXCON",expiresAt:"2099-01-01T00:00:00.000Z"});
let actor:RuntimeCommandActor;
let sharedGateway:InMemorySharedWorkflowGateway;
const command=(commandId="PATIENT-COMPLETE-1"):RuntimePatientCommandSubmission=>Object.freeze({
  exerciseId,patientId,commandId,commandType:"PATIENT_COMPLETE",patientBaseRevision:0,
  simulationTimeSec:120,payload:Object.freeze({}),
});

function scenarioEvents(){addScenarioEvent({id:"HISTORICAL-COMPLETION",patientId,triggerMinute:1,executed:true,
  exerciseId,action:"note.available",targetId:"NOTE-HISTORY",title:"Historical",
  description:"Already resolved patient event",resolvedAtMinute:1});
  addScenarioEvent({id:"PENDING-COMPLETION",patientId,triggerMinute:5,executed:false,
  exerciseId,action:"note.available",targetId:"NOTE-SYSTEM-001",title:"Pending",
  description:"Pending patient event"});}

function seedAcceptedSharedHead(revision=1):void{
  sharedGateway.seed(exerciseId,patientId,capturePatientSharedWorkflowState(patientId),"CM-001",revision);
  observeSharedWorkflowHead(exerciseId,patientId,revision,"CM-001");
}

describe("PATIENT-COMPLETE-OWNERSHIP-RELEASE-01 / PATCOMP-G01..G24",()=>{
  beforeEach(()=>{
    resetExercise();resetRuntimePatientCommandCursor();resetSharedWorkflowConflictMetrics();
    setSharedWorkflowConnectivity(true);setCurrentCaseManager({id:"CM-001",name:"CM 001"});
    actor={userId:"EXCON",role:"EXCON",exerciseIds:[exerciseId]};
    sharedGateway=new InMemorySharedWorkflowGateway(()=>({userId:"CM-001",role:"CM",exerciseIds:[exerciseId]}));
    setSharedWorkflowGateway(sharedGateway);
  });
  afterEach(()=>{setSharedWorkflowGateway(undefined);resetSharedWorkflowConflictMetrics();
    resetRuntimePatientCommandCursor();resetExercise();});

  test("normal writer materialization preserves completion effects exactly once",()=>{
    startExerciseSession(); assignPatientToMe(patientId);scenarioEvents();
    expect(materializePatientCompletion("COMPLETE-1",patientId,120,"EXCON")).toEqual({ok:true,status:"COMPLETED"});
    expect(findPatientById(patientId)?.status).toBe("Completed");
    expect(getPatientAssignment(patientId)).toMatchObject({endedAt:expect.any(String),endReason:"completed"});
    expect(getResolvedScenarioEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({id:"HISTORICAL-COMPLETION",executed:true,resolvedAtMinute:1}),
      expect.objectContaining({id:"PENDING-COMPLETION",cancelled:true,resolvedAtMinute:2}),
    ]));
    expect(getResolvedScenarioEvents().find(item=>item.id==="HISTORICAL-COMPLETION")?.cancelled).toBeUndefined();
    expect(getTimelineEvents(patientId).filter(item=>item.title==="Patsiendi käsitlus lõpetatud")).toEqual([
      expect.objectContaining({id:"TL-PATIENT-COMPLETE-COMPLETE-1",simulationTimeSec:120,authorId:"EXCON"}),
    ]);
    expect(materializePatientCompletion("COMPLETE-1",patientId,120,"EXCON")).toEqual({ok:true,status:"IDEMPOTENT"});
    expect(materializePatientCompletion("COMPLETE-2",patientId,180,"EXCON")).toEqual({ok:true,status:"IDEMPOTENT"});
    expect(getTimelineEvents(patientId).filter(item=>item.title==="Patsiendi käsitlus lõpetatud")).toHaveLength(1);
    expect(getExerciseSession().state).toBe("running");
  });

  test("reader acceptance does not mutate locally and writer materializes once",async()=>{
    assignPatientToMe(patientId);scenarioEvents();const gateway=new InMemoryRuntimePatientCommandGateway(()=>actor);
    gateway.seed(exerciseId,patientId,"CM-001");expect((await gateway.submit(command())).status).toBe("APPLIED");
    seedAcceptedSharedHead();
    expect(findPatientById(patientId)?.status).not.toBe("Completed");
    const consumer=new RuntimePatientCommandConsumer(gateway,materializeRuntimePatientCommand,()=>120);
    await consumer.drain(exerciseId,lease);
    expect(findPatientById(patientId)?.status).toBe("Completed");
    expect(getPatientAssignment(patientId)).toMatchObject({endedAt:expect.any(String),endReason:"completed"});
    expect(getSharedWorkflowHead(exerciseId,patientId)).toMatchObject({revision:2,ownerUserId:undefined});
    expect(sharedGateway.read(exerciseId,patientId)?.ownerUserId).toBeUndefined();
    expect((sharedGateway.read(exerciseId,patientId)?.state.assignments as {endedAt?:string}[])[0].endedAt).toBeDefined();
    restoreRuntimePatientCommandCursor(exerciseId,0);await consumer.drain(exerciseId,lease);
    expect(getTimelineEvents(patientId).filter(item=>item.title==="Patsiendi käsitlus lõpetatud")).toHaveLength(1);
    expect(sharedGateway.acceptedCount(exerciseId)).toBe(1);
  });

  test("accepted command survives writer absence and takeover consumes it once",async()=>{
    assignPatientToMe(patientId);const gateway=new InMemoryRuntimePatientCommandGateway(()=>actor);
    gateway.seed(exerciseId,patientId,"CM-001");expect((await gateway.submit(command("TAKEOVER"))).status).toBe("APPLIED");
    seedAcceptedSharedHead();
    expect(gateway.materialized(1)).toBeUndefined();
    const consumer=new RuntimePatientCommandConsumer(gateway,materializeRuntimePatientCommand,()=>120);
    await consumer.drain(exerciseId,{...lease,writerInstanceId:"TAKEOVER"});
    expect(gateway.materialized(1)).toMatchObject({status:"MATERIALIZED",result:{status:"COMPLETED"}});
    expect(getTimelineEvents(patientId).filter(item=>item.title==="Patsiendi käsitlus lõpetatud")).toHaveLength(1);
  });

  test("terminal fence rejects a new completion and drains one accepted before the fence",async()=>{
    assignPatientToMe(patientId);const gateway=new InMemoryRuntimePatientCommandGateway(()=>actor);gateway.seed(exerciseId,patientId,"CM-001");
    expect((await gateway.submit(command("BEFORE-FENCE"))).status).toBe("APPLIED");gateway.fence(exerciseId);
    seedAcceptedSharedHead();
    expect((await gateway.submit({...command("AFTER-FENCE"),patientBaseRevision:1})).status).toBe("COMPLETION_FENCED");
    const consumer=new RuntimePatientCommandConsumer(gateway,materializeRuntimePatientCommand,()=>120);
    await consumer.drain(exerciseId,lease);expect(findPatientById(patientId)?.status).toBe("Completed");
  });

  test("reconciles a checkpoint that is Completed while canonical ownership is still open",async()=>{
    assignPatientToMe(patientId);scenarioEvents();seedAcceptedSharedHead();
    setPatientStatus(patientId,"Completed");
    expect(getPatientAssignment(patientId)?.endedAt).toBeUndefined();
    await expect(materializePatientCompletionAuthoritatively({commandId:"PARTIAL",exerciseId,patientId,
      simulationTimeSec:120,actorUserId:"EXCON",acceptedPatientRevision:1}))
      .resolves.toMatchObject({ok:true,status:"IDEMPOTENT",ownershipStatus:"APPLIED"});
    expect(findPatientById(patientId)?.status).toBe("Completed");
    expect(getPatientAssignment(patientId)?.endedAt).toBeDefined();
    expect(getSharedWorkflowHead(exerciseId,patientId).ownerUserId).toBeUndefined();
    expect(getTimelineEvents(patientId).filter(item=>item.title==="Patsiendi käsitlus lõpetatud")).toHaveLength(0);
  });

  test("completed unowned replay is side-effect free and stale ownership cannot return",async()=>{
    assignPatientToMe(patientId);seedAcceptedSharedHead();
    await materializePatientCompletionAuthoritatively({commandId:"REPLAY",exerciseId,patientId,
      simulationTimeSec:120,actorUserId:"EXCON",acceptedPatientRevision:1});
    const revision=getSharedWorkflowHead(exerciseId,patientId).revision;
    await expect(materializePatientCompletionAuthoritatively({commandId:"REPLAY-AGAIN",exerciseId,patientId,
      simulationTimeSec:180,actorUserId:"EXCON",acceptedPatientRevision:revision}))
      .resolves.toEqual({ok:true,status:"IDEMPOTENT"});
    expect(getSharedWorkflowHead(exerciseId,patientId)).toEqual({revision,ownerUserId:undefined});
    expect(sharedGateway.acceptedCount(exerciseId)).toBe(1);
    expect(getAllActivePatientAssignments()).toEqual([]);
    expect(restoreAuthoritativePatientOwnershipProjection({exerciseId,patientId,revision:revision-1,
      ownerUserId:"CM-001",assignments:[{patientId,caseManagerId:"CM-001",caseManagerName:"CM 001",
        assignedAt:"2026-09-28T00:00:00.000Z"}],transfers:[]})).toBe(false);
    expect(getSharedWorkflowHead(exerciseId,patientId).ownerUserId).toBeUndefined();
  });

  test("cold restore preserves Completed, unowned, and the closed assignment",async()=>{
    assignPatientToMe(patientId);scenarioEvents();seedAcceptedSharedHead();
    await materializePatientCompletionAuthoritatively({commandId:"COLD-RESTORE",exerciseId,patientId,
      simulationTimeSec:120,actorUserId:"EXCON",acceptedPatientRevision:1});
    const canonical=sharedGateway.read(exerciseId,patientId);
    expect(canonical).toBeDefined();

    resetPatients();clearAssignments();clearTimelineEvents();
    restoreAuthoritativePatientSharedWorkflowState({exerciseId,patientId,revision:canonical!.revision,
      ownerUserId:canonical!.ownerUserId,state:canonical!.state as PatientSharedWorkflowState});

    expect(findPatientById(patientId)?.status).toBe("Completed");
    expect(getPatientAssignment(patientId)).toMatchObject({endedAt:expect.any(String),endReason:"completed"});
    expect(getAllActivePatientAssignments()).toEqual([]);
    expect(getSharedWorkflowHead(exerciseId,patientId).ownerUserId).toBeUndefined();
    expect(getTimelineEvents(patientId).filter(item=>item.title==="Patsiendi käsitlus lõpetatud")).toHaveLength(1);
  });

  test("canonical release failure rolls back every local completion side effect",async()=>{
    assignPatientToMe(patientId);scenarioEvents();seedAcceptedSharedHead();
    setSharedWorkflowConnectivity(false);

    await expect(materializePatientCompletionAuthoritatively({commandId:"OFFLINE",exerciseId,patientId,
      simulationTimeSec:120,actorUserId:"EXCON",acceptedPatientRevision:1}))
      .resolves.toMatchObject({ok:false,reason:"CANONICAL_OWNERSHIP_RELEASE_FAILED",
        ownershipStatus:"RECONNECT_REQUIRED"});
    expect(findPatientById(patientId)?.status).not.toBe("Completed");
    expect(getPatientAssignment(patientId)?.endedAt).toBeUndefined();
    expect(getTimelineEvents(patientId).filter(item=>item.title==="Patsiendi käsitlus lõpetatud")).toHaveLength(0);
    expect(getResolvedScenarioEvents().find(item=>item.id==="PENDING-COMPLETION")?.cancelled).toBeUndefined();
  });

  test("transport completion remains independent from patient and exercise completion",()=>{
    const engine=new PatientTransportEngine({version:"1",vehicleLocationId:"AMB",resources:[{resourceId:"R",
      resourceType:"AMBULANCE",displayName:"R",capacity:1,homeLocationId:"ED"}],destinations:[{destinationId:"D",
      displayName:"D",capabilities:[],travelDurationSec:10,handoverDurationSec:10,returnDurationSec:10,
      turnaroundDurationSec:0}]},{[patientId]:"ED"});
    engine.start("TRANSPORT",patientId,"R","D",0);engine.advanceTo(30);
    expect(engine.snapshot().transports[0].state).toBe("COMPLETED");
    expect(findPatientById(patientId)?.status).not.toBe("Completed");
  });
});
