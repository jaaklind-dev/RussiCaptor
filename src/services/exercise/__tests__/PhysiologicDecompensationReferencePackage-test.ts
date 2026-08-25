import { PHYSIOLOGIC_DECOMPENSATION_REFERENCE_EXERCISE_PACKAGE } from "../CanonicalExercisePackages";
import { packagePatientDatasetRegistry } from "../CanonicalPatientDatasets";
import { exercisePackageRegistry } from "../ExercisePackageService";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { canonicalRuntimePersistenceService, moduleCompositionHash } from "@/services/runtime/persistence/CanonicalRuntimePersistenceService";
import fs from "fs";
import path from "path";

describe("WP-48 reference package", () => {
  test("registers one opt-in generic patient without changing historical packages", () => {
    expect(exercisePackageRegistry.require(PHYSIOLOGIC_DECOMPENSATION_REFERENCE_EXERCISE_PACKAGE.packageId,"1.0.0")).toBeDefined();
    const dataset=packagePatientDatasetRegistry.resolve("patients.physiologic-decompensation-reference.v1");
    expect(dataset.patients).toHaveLength(1);
    expect(dataset.patients[0].runtimeFixture?.initialState).toMatchObject({physiologicDecompensationEnabled:true});
    expect(dataset.patients[0].runtimeFixture?.initialState).toHaveProperty("massiveTransfusion");
    expect(dataset.patients[0].runtimeFixture?.initialState).not.toHaveProperty("hypoxia");
    expect(dataset.patients[0].runtimeFixture?.activeResources).toMatchObject({resources:expect.arrayContaining([
      expect.objectContaining({type:"pelvicBinder"}), expect.objectContaining({type:"peripheralIV"}), expect.objectContaining({type:"centralVenousCatheter"}),
    ])});
    expect(PHYSIOLOGIC_DECOMPENSATION_REFERENCE_EXERCISE_PACKAGE.requiredClinicalModules).toEqual(expect.arrayContaining([
      expect.objectContaining({moduleId:"PELVIC_INJURY_V1"}), expect.objectContaining({moduleId:"MASSIVE_TRANSFUSION_V1"}),
    ]));
  });
  test("isolates reversible hemorrhagic rescue from an autonomous untreated hypoxia process", () => {
    const fixture=structuredClone(packagePatientDatasetRegistry.resolve("patients.physiologic-decompensation-reference.v1").patients[0].runtimeFixture!);
    const engine=new ClinicalScenarioEngine(); engine.reset(fixture);
    expect(engine.getPatientProcesses().some(process=>process.processType==="HYPOXIA")).toBe(false);
  });
  test("preserves signal, GCS and terminal progression through canonical rehydration", () => {
    const fixture=structuredClone(packagePatientDatasetRegistry.resolve("patients.physiologic-decompensation-reference.v1").patients[0].runtimeFixture!);
    const source=new ClinicalScenarioEngine(); source.reset(fixture); source.advanceTo(120);
    const identity={exerciseId:"EX-WP48",patientId:fixture.patientId!,packageId:PHYSIOLOGIC_DECOMPENSATION_REFERENCE_EXERCISE_PACKAGE.packageId,
      packageVersion:"1.0.0",packageHash:PHYSIOLOGIC_DECOMPENSATION_REFERENCE_EXERCISE_PACKAGE.packageHash,
      definitionHash:PHYSIOLOGIC_DECOMPENSATION_REFERENCE_EXERCISE_PACKAGE.manifest.definitionHash,
      moduleCompositionHash:moduleCompositionHash(PHYSIOLOGIC_DECOMPENSATION_REFERENCE_EXERCISE_PACKAGE.definition.clinicalModuleComposition?.modules ?? [])};
    const artifact=canonicalRuntimePersistenceService.capture(source,identity);
    const resumed=new ClinicalScenarioEngine(); canonicalRuntimePersistenceService.rehydrate(resumed,artifact,identity);
    expect(resumed.getRuntimeState()).toEqual(source.getRuntimeState());
  });
  test("places canonical pelvic stabilization in the CM patient action workspace", () => {
    const tab=fs.readFileSync(path.join(process.cwd(),"src/components/patient/InterventionsTab.tsx"),"utf8");
    const control=fs.readFileSync(path.join(process.cwd(),"src/components/patient/PelvicBinderControls.tsx"),"utf8");
    expect(tab).toContain("<PelvicBinderControls patientId={patientId} readOnly={readOnly} />");
    expect(control).toContain('resource.type === "pelvicBinder"');
    expect(control).toContain('issuedBy: "Case Manager"');
    expect(control).toContain("Paigalda vaagnalahas");
  });
  test("DEAD absorbs later physiology ticks and freezes cumulative blood loss", () => {
    const fixture=structuredClone(packagePatientDatasetRegistry.resolve("patients.physiologic-decompensation-reference.v1").patients[0].runtimeFixture!);
    const engine=new ClinicalScenarioEngine(); engine.reset(fixture);
    const tick=(at:number,minutes:number)=>{ engine.advanceTo(at); engine.dispatch({sequenceId:"DEAD",step:at,offsetSec:at,eventType:"ENGINE_TICK",
      actor:"ENGINE",target:fixture.patientId!,eventId:`DEAD-${at}`,result:"SUCCESS",payload:{tickMin:minutes}}); };
    for(let at=60;at<=3600 && engine.getRuntimeState().globalStatus!=="Dead";at+=60) tick(at,1);
    expect(engine.getRuntimeState().globalStatus).toBe("Dead");
    const before=engine.getPatientProcesses().find(process=>process.processType==="HEMORRHAGE")!;
    expect(before).toMatchObject({state:"Resolved",clinicalState:{activeHemorrhage:false,bleedingRateMlMin:0}});
    tick(2460,1);
    const after=engine.getPatientProcesses().find(process=>process.processType==="HEMORRHAGE")!;
    expect(after).toEqual(before);
  });
});
