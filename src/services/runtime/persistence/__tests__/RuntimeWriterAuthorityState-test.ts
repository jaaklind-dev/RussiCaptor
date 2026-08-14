import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { createScenarioEngineInstructorRuntimeOwner } from "@/services/runtime/instructor/ScenarioEngineInstructorRuntimeOwner";
import { setRuntimeWriterAuthorityState } from "../RuntimeWriterAuthorityState";

describe("WP-44B read-only runtime boundary",()=>{
  afterEach(()=>setRuntimeWriterAuthorityState("UNRESOLVED"));
  test("a reader cannot execute or advance patient runtime",()=>{
    const owner=createScenarioEngineInstructorRuntimeOwner(new ClinicalScenarioEngine(),"EX","PT");
    setRuntimeWriterAuthorityState("READER");
    expect(owner.execute({commandId:"C",exerciseId:"EX",patientId:"PT",eventType:"RESPIRATORY_DETERIORATION",issuedBy:"X",issuedAtSimulationTime:0,issuedAtWallClock:"2026-01-01T00:00:00.000Z"})).toEqual({ok:false,reason:"Runtime active on another device"});
    expect(owner.advanceRuntime?.("ADV",60)).toEqual({ok:false,reason:"Runtime active on another device"});
  });
  test("writer authority permits the normal runtime path",()=>{
    const engine=new ClinicalScenarioEngine(); const owner=createScenarioEngineInstructorRuntimeOwner(engine,"EX","PT");
    setRuntimeWriterAuthorityState("WRITER");
    expect(owner.advanceRuntime?.("ADV",60)).not.toEqual({ok:false,reason:"Runtime active on another device"});
  });
});
