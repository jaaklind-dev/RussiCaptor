import type { RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import type { RuntimePatientCommandSubmission } from "@/models/RuntimePatientCommand";
import { findPatientById } from "@/repositories/PatientRepository";
import { getExerciseSession, startExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { addScenarioEvent, getResolvedScenarioEvents } from "@/repositories/ScenarioRepository";
import { getTimelineEvents } from "@/repositories/TimelineRepository";
import { assignPatientToMe, getPatientAssignment } from "@/services/AssignmentRepository";
import { resetExercise } from "@/services/ExerciseResetService";
import { PatientTransportEngine } from "@/services/runtime/PatientTransportEngine";
import { materializePatientCompletion } from
  "@/services/runtime/exercise/PatientCompletionMaterializationService";
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

describe("PATIENT-COMPLETION-DURABLE-01 / PATCOMP-G01..G15",()=>{
  beforeEach(()=>{resetExercise();resetRuntimePatientCommandCursor();actor={userId:"EXCON",role:"EXCON",exerciseIds:[exerciseId]};});
  afterEach(()=>{resetRuntimePatientCommandCursor();resetExercise();});

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
    expect(findPatientById(patientId)?.status).not.toBe("Completed");
    const consumer=new RuntimePatientCommandConsumer(gateway,materializeRuntimePatientCommand,()=>120);
    await consumer.drain(exerciseId,lease);
    expect(findPatientById(patientId)?.status).toBe("Completed");
    restoreRuntimePatientCommandCursor(exerciseId,0);await consumer.drain(exerciseId,lease);
    expect(getTimelineEvents(patientId).filter(item=>item.title==="Patsiendi käsitlus lõpetatud")).toHaveLength(1);
  });

  test("accepted command survives writer absence and takeover consumes it once",async()=>{
    assignPatientToMe(patientId);const gateway=new InMemoryRuntimePatientCommandGateway(()=>actor);
    gateway.seed(exerciseId,patientId,"CM-001");expect((await gateway.submit(command("TAKEOVER"))).status).toBe("APPLIED");
    expect(gateway.materialized(1)).toBeUndefined();
    const consumer=new RuntimePatientCommandConsumer(gateway,materializeRuntimePatientCommand,()=>120);
    await consumer.drain(exerciseId,{...lease,writerInstanceId:"TAKEOVER"});
    expect(gateway.materialized(1)).toMatchObject({status:"MATERIALIZED",result:{status:"COMPLETED"}});
    expect(getTimelineEvents(patientId).filter(item=>item.title==="Patsiendi käsitlus lõpetatud")).toHaveLength(1);
  });

  test("terminal fence rejects a new completion and drains one accepted before the fence",async()=>{
    const gateway=new InMemoryRuntimePatientCommandGateway(()=>actor);gateway.seed(exerciseId,patientId,"CM-001");
    expect((await gateway.submit(command("BEFORE-FENCE"))).status).toBe("APPLIED");gateway.fence(exerciseId);
    expect((await gateway.submit({...command("AFTER-FENCE"),patientBaseRevision:1})).status).toBe("COMPLETION_FENCED");
    const consumer=new RuntimePatientCommandConsumer(gateway,materializeRuntimePatientCommand,()=>120);
    await consumer.drain(exerciseId,lease);expect(findPatientById(patientId)?.status).toBe("Completed");
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
