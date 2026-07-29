import type { CirculationState } from "@/models/CirculationState";
import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import type { MedicationAdministration, MedicationDefinition } from "@/models/MedicationRuntime";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { medicationAssessmentRules } from "@/services/runtime/assessment/MedicationAssessmentRules";
import { MedicationEngine } from "@/services/runtime/medication/MedicationEngine";

const definitions: MedicationDefinition[] = [{ medicationId: "MED-GENERIC", name: "Configured medication",
  routes: ["IV", "IO", "IM", "PO"], category: "other", durationSec: 60,
  supportedEffects: [{ effectType: "SUPPORT_CIRCULATION", parameters: { strength: 1 } }], metadata: {} }];
const circulation: CirculationState = { patientId: "PT-M", vascularAccess: [
  { interventionInstanceId: "IV-A", type: "PERIPHERAL_IV", resourceIds: ["IV"], establishedAt: 0 },
  { interventionInstanceId: "IO-A", type: "IO", resourceIds: ["IO"], establishedAt: 0 },
], hemorrhageControl: [], runningInfusions: [], updatedAt: 0 };
const admin = (overrides: Partial<MedicationAdministration> = {}): MedicationAdministration => ({
  administrationId: "A-1", medicationId: "MED-GENERIC", patientId: "PT-M", route: "IV", dose: 1,
  unit: "configured-unit", timestamp: 10, administrator: "CM-1", vascularAccessId: "IV-A", ...overrides });

describe("WP-15 MedicationEngine", () => {
  test("supports IV and IO administration and emits abstract effects", () => { const e = new MedicationEngine(); e.installDefinitions(definitions);
    expect(e.administer(admin(), circulation)).toMatchObject({ instance: { status: "ACTIVE" }, effects: [{ effectType: "SUPPORT_CIRCULATION" }] });
    expect(e.administer(admin({ administrationId: "A-2", route: "IO", vascularAccessId: "IO-A" }), circulation).instance?.status).toBe("ACTIVE"); });
  test("rejects invalid route, missing access and duplicate IDs", () => { const e = new MedicationEngine(); e.installDefinitions([{ ...definitions[0], routes: ["IV"] }]);
    expect(e.administer(admin({ route: "PO", vascularAccessId: undefined }), circulation).events[0].reasonCode).toBe("INVALID_ROUTE");
    expect(e.administer(admin({ administrationId: "NO-ACCESS", vascularAccessId: undefined }), circulation).events[0].reasonCode).toBe("MISSING_VASCULAR_ACCESS");
    expect(e.administer(admin({ administrationId: "NO-ACCESS", vascularAccessId: "IV-A" }), circulation).events[0].reasonCode).toBe("DUPLICATE_ADMINISTRATION"); });
  test("tracks cancellation, completion and multiple simultaneous medications", () => { const e = new MedicationEngine(); e.installDefinitions(definitions);
    e.administer(admin(), circulation); e.administer(admin({ administrationId: "A-2", route: "IM", vascularAccessId: undefined }), circulation);
    expect(e.active()).toHaveLength(2); expect(e.cancel("A-1", 20).eventType).toBe("MedicationCancelled");
    expect(e.advanceTo(70)).toContainEqual(expect.objectContaining({ eventType: "MedicationCompleted", administrationId: "A-2" }));
    expect(e.snapshot().instances.map(x => x.status)).toEqual(["CANCELLED", "COMPLETED"]); });
});

const fixture: GoldenFixture = { fixtureId: "FX-MED", fixtureType: "PROCESS", patientId: "PT-M", seed: 15,
  clockState: "RUNNING", ownershipVersion: 1, loadedModules: [], activeResources: { resources: [
    { resourceId: "IV", type: "peripheralIV", status: "AVAILABLE", metadata: {} }] },
  initialState: { processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV", ventilationReserve: 50,
    reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0 } };
const tick = (id:string,time:number): GoldenInputEvent => ({ sequenceId:"M",step:time,offsetSec:time,eventType:"ENGINE_TICK",actor:"ENGINE",target:"PT-M",eventId:id,result:"SUCCESS",payload:{tickMin:1} });
function replay() { const e=new ClinicalScenarioEngine(); e.installMedicationDefinitions(definitions); e.reset(fixture); e.setAssessmentRules(medicationAssessmentRules);
  e.scheduleIntervention({ interventionId:"IV-I",patientId:"PT-M",resourceId:"IV",action:"APPLY",timestamp:1,definitionId:"PERIPHERAL_IV_ACCESS",parameters:{location:"arm",gauge:18,attempts:1} });
  e.advanceTo(1); e.dispatch(tick("T1",1)); const access=e.getCirculationState().vascularAccess[0].interventionInstanceId;
  e.administerMedication(admin({ vascularAccessId:access,timestamp:2 })); e.advanceTo(2); e.dispatch(tick("T2",2)); return e; }
test("WP-15 medication state, effects, events, assessment and replay are deterministic",()=>{ const a=replay(),b=replay();
  expect(a.getMedicationState()).toContainEqual(expect.objectContaining({status:"ACTIVE"}));
  expect(a.getEventLog().map(x=>x.eventType)).toEqual(expect.arrayContaining(["MedicationOrdered","MedicationStarted"]));
  expect(a.getMedicationState()).toEqual(b.getMedicationState()); expect(a.getAssessmentSnapshot()).toEqual(b.getAssessmentSnapshot());
  expect(a.getEventLog()).toEqual(b.getEventLog()); expect(a.getHashes()).toEqual(b.getHashes()); });
