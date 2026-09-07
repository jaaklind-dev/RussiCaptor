import type { AnalgesicCommand } from "@/models/AnalgesiaMedication";
import type { CirculationState } from "@/models/CirculationState";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { AnalgesiaRuntime } from "../AnalgesiaRuntime";
import { analgesicProductById } from "../AnalgesicProducts";
import { FIBRINOGEN_CONCENTRATE_DEFINITION, FIBRINOGEN_CONCENTRATE_ID, FIBRYGA_ALIAS } from
  "../FibrinogenConcentrate";
import { bootstrapHemorrhagePatientProcess, setHemorrhageEffects, tickHemorrhagePatientProcess } from
  "../../HemorrhagePatientProcess";

const patientId = "PT";
const circulation: CirculationState = { patientId, vascularAccess: [{ interventionInstanceId: "IV-1",
  type: "PERIPHERAL_IV", resourceIds: ["PIV"], establishedAt: 0 }], hemorrhageControl: [], runningInfusions: [], updatedAt: 0 };
const start = (drugId: "PROPOFOL" | "MIDAZOLAM" | "ROCURONIUM", mode: "BOLUS" | "INFUSION" = "INFUSION") => {
  const config = analgesicProductById.get(drugId)!;
  return { commandId: `START-${drugId}`, action: "START", administrationId: `A-${drugId}`, patientId,
    drugId, simulationTimeSec: 0, mode, route: "IV", vascularAccessId: "IV-1",
    ...(mode === "BOLUS" ? { dose: config.referenceExposureDose, doseUnit: config.bolusDoseUnit } :
      { rate: config.referenceExposureDose, rateUnit: config.infusionRateUnit }) } satisfies AnalgesicCommand;
};

describe("WP-NARVA-02 medication and trauma capabilities", () => {
  test.each([["PROPOFOL", "HYPNOTIC_SEDATIVE"], ["MIDAZOLAM", "BENZODIAZEPINE_SEDATIVE"],
    ["ROCURONIUM", "NEUROMUSCULAR_BLOCKER"]] as const)("registers real %s as %s", (drugId, drugClass) => {
      expect(analgesicProductById.get(drugId)).toMatchObject({ drugId, drugClass });
    });

  test("propofol and midazolam sedate without analgesia while rocuronium only blocks neuromuscular transmission", () => {
    for (const drugId of ["PROPOFOL", "MIDAZOLAM", "ROCURONIUM"] as const) {
      const value = new AnalgesiaRuntime(); value.execute(start(drugId), circulation);
      const projection = value.projectionsAt(3600)[0];
      expect(projection.analgesia).toBe(0);
      if (drugId === "ROCURONIUM") expect(projection).toMatchObject({ sedation: 0, hypnosis: 0,
        neuromuscularBlockade: 1, trainOfFour: 0 });
      else expect(projection).toMatchObject({ neuromuscularBlockade: 0 });
    }
  });

  test("bounded combination is command-order independent and keeps NMB separate", () => {
    const a = new AnalgesiaRuntime(); const b = new AnalgesiaRuntime();
    ["PROPOFOL", "ROCURONIUM"].forEach(id => a.execute(start(id as "PROPOFOL" | "ROCURONIUM"), circulation));
    ["ROCURONIUM", "PROPOFOL"].forEach(id => b.execute(start(id as "PROPOFOL" | "ROCURONIUM"), circulation));
    expect(a.aggregateAt(patientId, 3600)).toEqual(b.aggregateAt(patientId, 3600));
    expect(a.aggregateAt(patientId, 3600)).toMatchObject({ rass: -5, bis: 40, trainOfFour: 0 });
  });

  test("stop preserves deterministic residual NMB offset and restart state", () => {
    const value = new AnalgesiaRuntime(); value.execute(start("ROCURONIUM"), circulation);
    value.execute({ ...start("ROCURONIUM"), commandId: "STOP", action: "STOP", simulationTimeSec: 3600 }, circulation);
    const snapshot = value.snapshot(); const restored = new AnalgesiaRuntime(); restored.restore(snapshot);
    expect(restored.projectionsAt(4800)).toEqual(value.projectionsAt(4800));
    expect(restored.projectionsAt(4800)[0].neuromuscularBlockade).toBeGreaterThan(0);
  });

  test("Fibryga is an alias of one fibrinogen substance with explicit grams", () => {
    expect(FIBRINOGEN_CONCENTRATE_DEFINITION).toMatchObject({ medicationId: FIBRINOGEN_CONCENTRATE_ID,
      metadata: { aliases: [FIBRYGA_ALIAS], doseUnit: "G" }, supportedEffects: [{
        effectType: "COAGULATION_SUBSTRATE_SUPPORT" }] });
  });

  test("fibrinogen corrects only configured substrate deficiency and remains independent from TXA", () => {
    const configuration = { baselineBleedingRateMlMin: 100, tourniquetEfficiency: 0, binderEfficiency: 0,
      infusionOffsetMlMin: 0, bloodProductOffsetMlMin: 0, severityThresholdsMl: [100, 200, 300, 400] as const,
      perfusionThresholdsMl: [100, 200, 300] as const, compensationThresholdsMl: [100, 200] as const,
      trendThresholdsMlMin: { worsening: 20, improving: 1 }, coagulation: { fibrinogenDeficiencyFactor: 1.5,
        fibrinogenCorrectionPerGram: 0.1 }, fibrinolysis: { excessFactor: 1.5, txaSensitivity: 1 } };
    let process = bootstrapHemorrhagePatientProcess(patientId, { configuration });
    process = setHemorrhageEffects(process, [{ effectId: "FIB", effectType: "COAGULATION_SUBSTRATE_SUPPORT",
      encounterId: patientId, patientId, timestamp: 0, sourceInterventionInstanceId: "FIB",
      parameters: { dose: 5, unit: "G" } }]);
    const result = tickHemorrhagePatientProcess(process, 60);
    expect(result.process.clinicalState).toMatchObject({ fibrinogenDoseG: 5, effectiveFibrinogenFactor: 1,
      effectiveFibrinolysisFactor: 1.5, bleedingRateMlMin: 150 });
  });

  test.each([["PT-PELVIC-001", "WITHIN_WINDOW"], ["PT-CHEST-001", "WITHIN_WINDOW"]] as const)(
    "TXA for %s uses authoritative injury time", (id, classification) => {
      const record = packagePatientDatasetRegistry.resolve("patients.narva-trauma.v1").patients.find(item => item.patient.id === id)!;
      const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(record.runtimeFixture!));
      const payload = engine.captureRuntimePayload();
      const withAccess = { ...payload, circulation: { states: [{ patientId: id, vascularAccess: [{
        interventionInstanceId: "IV-1", type: "PERIPHERAL_IV" as const, resourceIds: ["PIV"], establishedAt: 0,
      }], hemorrhageControl: [], runningInfusions: [], updatedAt: 0 }], events: [] } };
      engine.rehydrateRuntimePayload(withAccess);
      expect(engine.executeTranexamicAcidCommand({ commandId: `TXA-${id}`, action: "START", regimenId: `R-${id}`,
        patientId: id, simulationTimeSec: 0, vascularAccessId: "IV-1" })).toMatchObject({ status: "APPLIED",
        state: { timingClassification: classification } });
    });
});
