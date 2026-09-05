import type { AlsMedicationCommand, AlsMedicationId, AlsRhythmContext } from "@/models/AlsMedication";
import type { CardiacArrestPatientProcessRuntime, CardiacRhythm } from "@/models/PatientProcessRuntime";
import type { CirculationState } from "@/models/CirculationState";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { getPatientResourceDebugSnapshot } from "@/services/ResourceRuntimeDebugService";
import { CARDIAC_ARREST_REFERENCE_FIXTURE } from "@/services/golden/CardiacArrestReferenceFixture";
import { MedicationEngine } from "@/services/runtime/medication/MedicationEngine";
import { bootstrapCardiacArrestPatientProcess, classifyCardiacRhythm } from
  "@/services/runtime/CardiacArrestPatientProcess";
import { AlsMedicationRuntime } from "@/services/runtime/medication/AlsMedicationRuntime";
import {
  ERC_2025_ADULT_ALS_PRODUCTS,
  ERC_2025_ADULT_ALS_PROFILE,
  alsMedicationClinicalFeatureContracts,
} from "@/services/runtime/medication/Erc2025AdultAlsProfile";

const patientId = "PT-CARDIAC-REFERENCE";
const circulation: CirculationState = {
  patientId,
  vascularAccess: [
    { interventionInstanceId: "IV-1", type: "PERIPHERAL_IV", resourceIds: ["PIV-1"], establishedAt: 0 },
    { interventionInstanceId: "IO-1", type: "IO", resourceIds: ["IO-1"], establishedAt: 0 },
  ],
  hemorrhageControl: [], runningInfusions: [], updatedAt: 0,
};

const context = (overrides: Partial<AlsRhythmContext> = {}): AlsRhythmContext => ({
  patientId, cardiacState: "ARREST", rhythm: "PEA", rhythmClassification: "NON_SHOCKABLE",
  shockAttemptCount: 0, cprActive: true, hyperkalaemiaSubstrate: "UNMODELED", ...overrides,
});

const defaults: Record<AlsMedicationId, Pick<AlsMedicationCommand,
  "dose" | "doseUnit" | "route" | "vascularAccessId" | "concentrationId">> = {
  ADRENALINE: { dose: 1, doseUnit: "MG", route: "IV", vascularAccessId: "IV-1" },
  AMIODARONE: { dose: 300, doseUnit: "MG", route: "IV", vascularAccessId: "IV-1" },
  LIDOCAINE: { dose: 100, doseUnit: "MG", route: "IV", vascularAccessId: "IV-1" },
  ATROPINE: { dose: 500, doseUnit: "MCG", route: "IV", vascularAccessId: "IV-1" },
  ADENOSINE: { dose: 6, doseUnit: "MG", route: "IV", vascularAccessId: "IV-1" },
  MAGNESIUM_SULFATE: { dose: 2000, doseUnit: "MG", route: "IV", vascularAccessId: "IV-1" },
  CALCIUM_CHLORIDE: { dose: 10, doseUnit: "ML", route: "IV", vascularAccessId: "IV-1",
    concentrationId: "CALCIUM_CHLORIDE_10_PERCENT" },
  SODIUM_BICARBONATE: { dose: 50, doseUnit: "MMOL", route: "IV", vascularAccessId: "IV-1" },
};

function command(drugId: AlsMedicationId, index = 0,
  overrides: Partial<AlsMedicationCommand> = {}): AlsMedicationCommand {
  return { commandId: `${drugId}-COMMAND-${index}`, administrationId: `${drugId}-ADMIN-${index}`,
    patientId, drugId, simulationTimeSec: 0, ...defaults[drugId], ...overrides };
}

function engineWithContext(overrides: Partial<CardiacArrestPatientProcessRuntime["clinicalState"]> = {}):
  ClinicalScenarioEngine {
  const source = new ClinicalScenarioEngine();
  source.reset(CARDIAC_ARREST_REFERENCE_FIXTURE);
  const payload = source.captureRuntimePayload();
  const processes = payload.processes.map(item => item.processType !== "CARDIAC_ARREST" ? item : ({
    ...item, clinicalState: { ...item.clinicalState, ...overrides },
  } as CardiacArrestPatientProcessRuntime));
  const engine = new ClinicalScenarioEngine();
  engine.rehydrateRuntimePayload({ ...payload, processes, circulation: { states: [circulation], events: [] } });
  return engine;
}

describe("ERC 2025 Adult ALS medication Runtime", () => {
  test("declares one explicit versioned guideline profile separate from eight product definitions", () => {
    expect(ERC_2025_ADULT_ALS_PROFILE).toMatchObject({ profileId: "ERC_2025_ADULT_ALS", version: "2025.1",
      adrenaline: { doseMg: 1, repeatMinSec: 180, repeatMaxSec: 300, firstShockableDoseAfterShock: 3 },
      amiodarone: { doseSequenceMg: [300, 150], shockSequence: [3, 5] },
      lidocaine: { doseSequenceMg: [100, 50], shockSequence: [3, 5] },
      atropine: { doseMcg: 500, maximumCumulativeMcg: 3000 }, adenosine: { doseSequenceMg: [6, 12, 18] },
    });
    expect(ERC_2025_ADULT_ALS_PRODUCTS.map(item => item.drugId)).toEqual([
      "ADRENALINE", "AMIODARONE", "LIDOCAINE", "ATROPINE", "ADENOSINE", "MAGNESIUM_SULFATE",
      "CALCIUM_CHLORIDE", "SODIUM_BICARBONATE",
    ]);
    expect(alsMedicationClinicalFeatureContracts).toHaveLength(8);
    expect(alsMedicationClinicalFeatureContracts.every(item => item.determinism.clock === "SIMULATION_TIME" &&
      item.idempotency.key === "COMMAND_ID")).toBe(true);
  });

  test.each(["SINUS_BRADYCARDIA", "REGULAR_NARROW_COMPLEX_SVT", "TORSADES_DE_POINTES"] as const)(
    "represents peri-arrest rhythm %s in the authoritative cardiac process", rhythm => {
      const process = bootstrapCardiacArrestPatientProcess({ fixtureId: `FX-${rhythm}`, patientId },
        { adverseSigns: rhythm === "SINUS_BRADYCARDIA" }, { initialState: "PERFUSING", initialRhythm: rhythm });
      expect(process.clinicalState).toMatchObject({ cardiacState: "PERFUSING", rhythm,
        rhythmClassification: "PERFUSING" });
      expect(classifyCardiacRhythm(rhythm)).toBe("PERFUSING");
    },
  );

  test.each(["PEA", "ASYSTOLE"] as CardiacRhythm[])(
    "makes first 1 mg adrenaline guideline-eligible immediately in %s arrest", rhythm => {
      const runtime = new AlsMedicationRuntime();
      expect(runtime.execute(command("ADRENALINE"), circulation, context({ rhythm }))).toMatchObject({
        status: "APPLIED", state: { drugId: "ADRENALINE", dose: 1, route: "IV",
          protocolClassification: "GUIDELINE_ELIGIBLE", shockCountAtAdministration: 0,
          physiologyStatus: "ACTIVE" },
      });
      expect(runtime.projectionsAt(0)[0].currentEffect.arrestVasoactiveSupport).toBe(1);
    },
  );

  test("classifies adrenaline repeats at <3, 3–5 and >5 minutes", () => {
    const runtime = new AlsMedicationRuntime();
    runtime.execute(command("ADRENALINE", 0), circulation, context());
    expect(runtime.execute(command("ADRENALINE", 1, { simulationTimeSec: 179 }), circulation, context()))
      .toMatchObject({ status: "APPLIED", state: { protocolClassification: "REPEAT_TOO_SOON",
        physiologyStatus: "NO_DIRECT_EFFECT" } });
    const atThree = new AlsMedicationRuntime();
    atThree.execute(command("ADRENALINE", 0), circulation, context());
    expect(atThree.execute(command("ADRENALINE", 1, { simulationTimeSec: 180 }), circulation, context()))
      .toMatchObject({ state: { protocolClassification: "GUIDELINE_ELIGIBLE" } });
    const overdue = new AlsMedicationRuntime();
    overdue.execute(command("ADRENALINE", 0), circulation, context());
    expect(overdue.execute(command("ADRENALINE", 1, { simulationTimeSec: 301 }), circulation, context()))
      .toMatchObject({ state: { protocolClassification: "OVERDUE_GUIDELINE_ELIGIBLE" } });
  });

  test.each([[2, "TOO_EARLY_FOR_SHOCKABLE_ALGORITHM"], [3, "GUIDELINE_ELIGIBLE"]] as const)(
    "classifies first shockable adrenaline at shock %i", (shockAttemptCount, expected) => {
      expect(new AlsMedicationRuntime().execute(command("ADRENALINE"), circulation,
        context({ rhythm: "VF", rhythmClassification: "SHOCKABLE", shockAttemptCount })))
        .toMatchObject({ status: "APPLIED", state: { protocolClassification: expected,
          shockCountAtAdministration: shockAttemptCount } });
    },
  );

  test("keeps arrest adrenaline distinct from norepinephrine and never causes deterministic ROSC", () => {
    const runtime = new AlsMedicationRuntime();
    runtime.execute(command("ADRENALINE"), circulation, context());
    expect(runtime.projectionsAt(60)[0]).toMatchObject({ featureId: "ADRENALINE",
      cardiacStateAtAdministration: "ARREST", rhythmAtAdministration: "PEA" });
    expect(runtime.projectionsAt(60)[0].currentEffect.arrestVasoactiveSupport).toBeGreaterThan(0);
    expect(runtime.projectionsAt(60)[0]).not.toHaveProperty("currentRhythm");
    expect(JSON.stringify(runtime.snapshot())).not.toContain("NOREPINEPHRINE");
  });

  test("updates arrest eligibility immediately at the ROSC boundary while preserving history", () => {
    const runtime = new AlsMedicationRuntime();
    runtime.execute(command("ADRENALINE", 0), circulation, context());
    const before = runtime.snapshot();
    expect(runtime.execute(command("ADRENALINE", 1, { simulationTimeSec: 180 }), circulation,
      context({ cardiacState: "ROSC", rhythm: "PERFUSING", rhythmClassification: "PERFUSING" })))
      .toMatchObject({ status: "APPLIED", state: { protocolClassification: "OUTSIDE_CARDIAC_ARREST_CONTEXT" } });
    expect(runtime.snapshot()!.administrations[0]).toEqual(before!.administrations[0]);
  });

  test.each([[2, 300, "WRONG_SHOCK_COUNT"], [3, 300, "GUIDELINE_ELIGIBLE"]] as const)(
    "classifies amiodarone after shock %i at %i mg", (shockCount, dose, expected) => {
      expect(new AlsMedicationRuntime().execute(command("AMIODARONE", 0, { dose }), circulation,
        context({ rhythm: "VF", rhythmClassification: "SHOCKABLE", shockAttemptCount: shockCount })))
        .toMatchObject({ status: "APPLIED", state: { protocolClassification: expected } });
    },
  );

  test("supports the amiodarone 300 mg after shock 3 and 150 mg after total shock 5 course", () => {
    const runtime = new AlsMedicationRuntime();
    runtime.execute(command("AMIODARONE", 0), circulation,
      context({ rhythm: "VF", rhythmClassification: "SHOCKABLE", shockAttemptCount: 3 }));
    expect(runtime.execute(command("AMIODARONE", 1, { dose: 150, simulationTimeSec: 120 }), circulation,
      context({ rhythm: "PULSELESS_VT", rhythmClassification: "SHOCKABLE", shockAttemptCount: 5 })))
      .toMatchObject({ state: { protocolClassification: "GUIDELINE_ELIGIBLE", shockCountAtAdministration: 5 } });
    expect(runtime.courseFor(patientId)).toMatchObject({ antiarrhythmicStrategy: "AMIODARONE",
      amiodaroneDosesMg: [300, 150] });
  });

  test("classifies a duplicate amiodarone 300 mg course dose", () => {
    const runtime = new AlsMedicationRuntime();
    runtime.execute(command("AMIODARONE", 0), circulation,
      context({ rhythm: "VF", rhythmClassification: "SHOCKABLE", shockAttemptCount: 3 }));
    expect(runtime.execute(command("AMIODARONE", 1, { dose: 300 }), circulation,
      context({ rhythm: "VF", rhythmClassification: "SHOCKABLE", shockAttemptCount: 5 })))
      .toMatchObject({ status: "APPLIED", state: { protocolClassification: "DUPLICATE_COURSE_DOSE" } });
  });

  test("uses total recurrent shock history rather than requiring consecutive VF", () => {
    expect(new AlsMedicationRuntime().execute(command("AMIODARONE"), circulation,
      context({ rhythm: "PULSELESS_VT", rhythmClassification: "SHOCKABLE", shockAttemptCount: 3 })))
      .toMatchObject({ state: { protocolClassification: "GUIDELINE_ELIGIBLE", shockCountAtAdministration: 3 } });
  });

  test("supports lidocaine 100/50 mg as an alternative and records mixed-strategy conflict factually", () => {
    const runtime = new AlsMedicationRuntime();
    expect(runtime.execute(command("LIDOCAINE", 0), circulation,
      context({ rhythm: "VF", rhythmClassification: "SHOCKABLE", shockAttemptCount: 3 })))
      .toMatchObject({ state: { protocolClassification: "GUIDELINE_ELIGIBLE" } });
    expect(runtime.execute(command("LIDOCAINE", 1, { dose: 50 }), circulation,
      context({ rhythm: "VF", rhythmClassification: "SHOCKABLE", shockAttemptCount: 5 })))
      .toMatchObject({ state: { protocolClassification: "GUIDELINE_ELIGIBLE" } });
    expect(runtime.execute(command("AMIODARONE", 2), circulation,
      context({ rhythm: "VF", rhythmClassification: "SHOCKABLE", shockAttemptCount: 5 })))
      .toMatchObject({ status: "APPLIED", state: { protocolClassification: "ANTIARRHYTHMIC_STRATEGY_CONFLICT",
        physiologyStatus: "NO_DIRECT_EFFECT" } });
    expect(runtime.courseFor(patientId).antiarrhythmicStrategy).toBe("MIXED");
  });

  test("antiarrhythmics expose bounded susceptibility support without directly converting rhythm", () => {
    const runtime = new AlsMedicationRuntime();
    runtime.execute(command("AMIODARONE"), circulation,
      context({ rhythm: "VF", rhythmClassification: "SHOCKABLE", shockAttemptCount: 3 }));
    expect(runtime.projectionsAt(1)[0].currentEffect.antiarrhythmicSupport).toBeGreaterThan(0);
    expect(runtime.snapshot()!.administrations[0].rhythmAtAdministration).toBe("VF");
  });

  test("models atropine 500 mcg for adverse-sign sinus bradycardia only", () => {
    const runtime = new AlsMedicationRuntime();
    const brady = context({ cardiacState: "PERFUSING", rhythm: "SINUS_BRADYCARDIA",
      rhythmClassification: "PERFUSING", adverseSigns: true });
    expect(runtime.execute(command("ATROPINE"), circulation, brady)).toMatchObject({ status: "APPLIED",
      state: { protocolClassification: "GUIDELINE_ELIGIBLE", physiologyStatus: "ACTIVE" } });
    expect(runtime.vitalContributorsAt(0)).toEqual([expect.objectContaining({ vital: "heartRate",
      layer: "MEDICATION", operation: "DELTA", value: 20 })]);
  });

  test("atropine does not normalize arrest/asystole and requires adverse signs", () => {
    expect(new AlsMedicationRuntime().execute(command("ATROPINE"), circulation,
      context({ rhythm: "ASYSTOLE" }))).toMatchObject({ status: "APPLIED",
      state: { protocolClassification: "INAPPROPRIATE_IN_CARDIAC_ARREST", physiologyStatus: "NO_DIRECT_EFFECT" } });
    expect(new AlsMedicationRuntime().execute(command("ATROPINE"), circulation,
      context({ cardiacState: "PERFUSING", rhythm: "SINUS_BRADYCARDIA",
        rhythmClassification: "PERFUSING", adverseSigns: false }))).toMatchObject({
          state: { protocolClassification: "BRADYCARDIA_ADVERSE_SIGNS_REQUIRED" },
        });
  });

  test("enforces atropine repeat timing and factual 3 mg cumulative ceiling", () => {
    const brady = context({ cardiacState: "PERFUSING", rhythm: "SINUS_BRADYCARDIA",
      rhythmClassification: "PERFUSING", adverseSigns: true });
    const early = new AlsMedicationRuntime(); early.execute(command("ATROPINE", 0), circulation, brady);
    expect(early.execute(command("ATROPINE", 1, { simulationTimeSec: 179 }), circulation, brady))
      .toMatchObject({ state: { protocolClassification: "REPEAT_TOO_SOON" } });
    const course = new AlsMedicationRuntime();
    for (let index = 0; index < 6; index += 1) {
      expect(course.execute(command("ATROPINE", index, { simulationTimeSec: index * 180 }), circulation, brady))
        .toMatchObject({ state: { protocolClassification: "GUIDELINE_ELIGIBLE" } });
    }
    expect(course.courseFor(patientId).atropineCumulativeMcg).toBe(3000);
    expect(course.vitalContributorsAt(900)).toEqual([expect.objectContaining({ value: 20 })]);
    expect(course.execute(command("ATROPINE", 6, { simulationTimeSec: 1080 }), circulation, brady))
      .toMatchObject({ status: "APPLIED", state: { protocolClassification: "CUMULATIVE_DOSE_EXCEEDED" } });
  });

  test("models the adenosine 6 → 12 → 18 mg rapid-IV course", () => {
    const runtime = new AlsMedicationRuntime();
    const svt = context({ cardiacState: "PERFUSING", rhythm: "REGULAR_NARROW_COMPLEX_SVT",
      rhythmClassification: "PERFUSING" });
    [6, 12, 18].forEach((dose, index) => expect(runtime.execute(command("ADENOSINE", index,
      { dose, simulationTimeSec: index * 30 }), circulation, svt)).toMatchObject({
        status: "APPLIED", state: { protocolClassification: "GUIDELINE_ELIGIBLE" },
      }));
    expect(runtime.courseFor(patientId).adenosineDosesMg).toEqual([6, 12, 18]);
    expect(runtime.projectionsAt(61)[0].currentEffect.avNodalEffect).toBe(0);
    expect(runtime.projectionsAt(61)[2].currentEffect.avNodalEffect).toBeGreaterThan(0);
  });

  test("adenosine rejects IO technically and preserves unsupported rhythms without forced conversion", () => {
    const svt = context({ cardiacState: "PERFUSING", rhythm: "REGULAR_NARROW_COMPLEX_SVT",
      rhythmClassification: "PERFUSING" });
    expect(new AlsMedicationRuntime().execute(command("ADENOSINE", 0,
      { route: "IO", vascularAccessId: "IO-1" }), circulation, svt))
      .toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_ROUTE" });
    const wrong = new AlsMedicationRuntime();
    expect(wrong.execute(command("ADENOSINE"), circulation,
      context({ cardiacState: "PERFUSING", rhythm: "PERFUSING", rhythmClassification: "PERFUSING" })))
      .toMatchObject({ status: "APPLIED", state: { protocolClassification: "WRONG_RHYTHM",
        physiologyStatus: "NO_DIRECT_EFFECT", rhythmAtAdministration: "PERFUSING" } });
  });

  test("limits magnesium support to torsades and not generic VF", () => {
    expect(new AlsMedicationRuntime().execute(command("MAGNESIUM_SULFATE"), circulation,
      context({ cardiacState: "PERFUSING", rhythm: "TORSADES_DE_POINTES",
        rhythmClassification: "PERFUSING" }))).toMatchObject({ state: {
          protocolClassification: "GUIDELINE_ELIGIBLE", physiologyStatus: "ACTIVE" } });
    expect(new AlsMedicationRuntime().execute(command("MAGNESIUM_SULFATE"), circulation,
      context({ rhythm: "VF", rhythmClassification: "SHOCKABLE" }))).toMatchObject({
        status: "APPLIED", state: { protocolClassification: "WRONG_RHYTHM", physiologyStatus: "NO_DIRECT_EFFECT" },
      });
  });

  test.each(["CALCIUM_CHLORIDE", "SODIUM_BICARBONATE"] as const)(
    "%s is never routine and stays deferred without an electrolyte substrate", drugId => {
      expect(new AlsMedicationRuntime().execute(command(drugId), circulation, context()))
        .toMatchObject({ status: "APPLIED", state: { protocolClassification: "SUBSTRATE_UNMODELED",
          physiologyStatus: "DEFERRED_NO_SUBSTRATE" } });
      expect(new AlsMedicationRuntime().execute(command(drugId), circulation,
        context({ hyperkalaemiaSubstrate: "ABSENT" }))).toMatchObject({ status: "APPLIED",
          state: { protocolClassification: "SPECIFIC_INDICATION_REQUIRED" } });
      expect(new AlsMedicationRuntime().execute(command(drugId), circulation,
        context({ hyperkalaemiaSubstrate: "HYPERKALAEMIA_WITH_ECG_CHANGES" }))).toMatchObject({ status: "APPLIED",
          state: { protocolClassification: "GUIDELINE_ELIGIBLE", physiologyStatus: "DEFERRED_NO_SUBSTRATE" } });
    },
  );

  test("requires calcium chloride 10% concentration identity", () => {
    expect(new AlsMedicationRuntime().execute(command("CALCIUM_CHLORIDE", 0,
      { concentrationId: undefined }), circulation, context())).toMatchObject({ status: "REJECTED",
        rejectionReason: "INVALID_UNIT" });
  });

  test("distinguishes technically invalid input from clinically inappropriate treatment", () => {
    expect(new AlsMedicationRuntime().execute(command("ADRENALINE", 0, { dose: Number.NaN }), circulation,
      context())).toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_DOSE" });
    expect(new AlsMedicationRuntime().execute(command("ADRENALINE", 0, { doseUnit: "MCG" }), circulation,
      context())).toMatchObject({ status: "REJECTED", rejectionReason: "INVALID_UNIT" });
    expect(new AlsMedicationRuntime().execute(command("ADRENALINE", 0, { vascularAccessId: "NONE" }), circulation,
      context())).toMatchObject({ status: "REJECTED", rejectionReason: "MISSING_VASCULAR_ACCESS" });
    expect(new AlsMedicationRuntime().execute(command("ADRENALINE", 0, { dose: 2 }), circulation,
      context())).toMatchObject({ status: "APPLIED", state: { protocolClassification: "WRONG_DOSE" } });
  });

  test("supports IV and IO arrest routes through canonical access", () => {
    expect(new AlsMedicationRuntime().execute(command("ADRENALINE", 0), circulation, context()).status).toBe("APPLIED");
    expect(new AlsMedicationRuntime().execute(command("ADRENALINE", 1,
      { route: "IO", vascularAccessId: "IO-1" }), circulation, context()).status).toBe("APPLIED");
  });

  test("is command-idempotent and rejects a distinct command reusing an administration ID", () => {
    const runtime = new AlsMedicationRuntime(); const first = command("ADRENALINE");
    expect(runtime.execute(first, circulation, context()).status).toBe("APPLIED");
    expect(runtime.execute(first, circulation, context()).status).toBe("IDEMPOTENT");
    expect(runtime.execute(command("ADRENALINE", 1, { administrationId: first.administrationId }), circulation,
      context())).toMatchObject({ status: "REJECTED", rejectionReason: "DUPLICATE_ADMINISTRATION" });
    expect(runtime.snapshot()!.administrations).toHaveLength(1);
    expect(runtime.snapshot()!.events.filter(item => item.eventType === "AlsMedicationAdministered")).toHaveLength(1);
  });

  test.each(ERC_2025_ADULT_ALS_PRODUCTS.map(item => item.drugId))(
    "round-trips %s factual administration and command evidence", drugId => {
      const rhythm = drugId === "ATROPINE" ? context({ cardiacState: "PERFUSING", rhythm: "SINUS_BRADYCARDIA",
        rhythmClassification: "PERFUSING", adverseSigns: true }) :
        drugId === "ADENOSINE" ? context({ cardiacState: "PERFUSING", rhythm: "REGULAR_NARROW_COMPLEX_SVT",
          rhythmClassification: "PERFUSING" }) :
          drugId === "MAGNESIUM_SULFATE" ? context({ cardiacState: "PERFUSING", rhythm: "TORSADES_DE_POINTES",
            rhythmClassification: "PERFUSING" }) : context({ rhythm: drugId === "AMIODARONE" ||
              drugId === "LIDOCAINE" ? "VF" : "PEA", rhythmClassification: drugId === "AMIODARONE" ||
              drugId === "LIDOCAINE" ? "SHOCKABLE" : "NON_SHOCKABLE", shockAttemptCount: 5 });
      const original = new AlsMedicationRuntime(); original.execute(command(drugId), circulation, rhythm);
      const restored = new AlsMedicationRuntime(); restored.restore(original.snapshot());
      expect(restored.snapshot()).toEqual(original.snapshot());
      expect(restored.projectionsAt(60)).toEqual(original.projectionsAt(60));
      expect(restored.execute(command(drugId), circulation, rhythm).status).toBe("IDEMPOTENT");
    },
  );

  test("keeps the optional ALS persistence branch absent when unused", () => {
    const engine = new MedicationEngine();
    expect(engine.snapshot()).not.toHaveProperty("alsMedications");
    expect(engine.alsMedicationProjectionsAt(3600)).toEqual([]);
  });

  test("round-trips multi-dose arrest, peri-arrest, reversible-cause and ROSC evidence together", () => {
    const runtime = new AlsMedicationRuntime();
    runtime.execute(command("ADRENALINE", 0), circulation, context());
    runtime.execute(command("ADRENALINE", 1, { simulationTimeSec: 180 }), circulation, context());
    const shockable = context({ rhythm: "VF", rhythmClassification: "SHOCKABLE", shockAttemptCount: 5 });
    runtime.execute(command("AMIODARONE", 0, { simulationTimeSec: 200 }), circulation, shockable);
    runtime.execute(command("AMIODARONE", 1, { dose: 150, simulationTimeSec: 220 }), circulation, shockable);
    const brady = context({ cardiacState: "PERFUSING", rhythm: "SINUS_BRADYCARDIA",
      rhythmClassification: "PERFUSING", adverseSigns: true });
    runtime.execute(command("ATROPINE", 0, { simulationTimeSec: 300 }), circulation, brady);
    runtime.execute(command("ATROPINE", 1, { simulationTimeSec: 480 }), circulation, brady);
    const svt = context({ cardiacState: "PERFUSING", rhythm: "REGULAR_NARROW_COMPLEX_SVT",
      rhythmClassification: "PERFUSING" });
    [6, 12, 18].forEach((dose, index) => runtime.execute(command("ADENOSINE", index,
      { dose, simulationTimeSec: 700 + index * 30 }), circulation, svt));
    runtime.execute(command("MAGNESIUM_SULFATE", 0, { simulationTimeSec: 800 }), circulation,
      context({ cardiacState: "PERFUSING", rhythm: "TORSADES_DE_POINTES", rhythmClassification: "PERFUSING" }));
    runtime.execute(command("CALCIUM_CHLORIDE", 0, { simulationTimeSec: 820 }), circulation, context());
    runtime.execute(command("SODIUM_BICARBONATE", 0, { simulationTimeSec: 840 }), circulation, context());
    runtime.execute(command("ADRENALINE", 2, { simulationTimeSec: 900 }), circulation,
      context({ cardiacState: "ROSC", rhythm: "PERFUSING", rhythmClassification: "PERFUSING" }));
    const snapshot = runtime.snapshot()!; const restored = new AlsMedicationRuntime(); restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.projectionsAt(900)).toEqual(runtime.projectionsAt(900));
    expect(restored.courseFor(patientId)).toEqual(runtime.courseFor(patientId));
  });

  test("MedicationEngine restores ALS independently from all accepted medication branches", () => {
    const engine = new MedicationEngine();
    engine.executeAlsMedication(command("ADRENALINE"), circulation, context());
    engine.executeNorepinephrine({ commandId: "NE", action: "START", infusionId: "NE-1", patientId,
      simulationTimeSec: 0, doseMicrogramsPerKgMin: 0.1, unit: "MCG_KG_MIN", vascularAccessId: "IV-1" }, circulation);
    engine.executeFluidTherapy({ commandId: "RINGER", action: "START", administrationId: "RINGER-1", patientId,
      fluidType: "RINGER", simulationTimeSec: 0, mode: "BOLUS", prescribedVolumeMl: 500, volumeUnit: "ML",
      rateMlHour: 1000, rateUnit: "ML_H", vascularAccessId: "IV-1" }, circulation);
    engine.executeTranexamicAcid({ commandId: "TXA", action: "START", regimenId: "TXA-1", patientId,
      simulationTimeSec: 0, vascularAccessId: "IV-1" }, circulation, 0);
    engine.executeAnalgesic({ commandId: "FENT", action: "START", administrationId: "FENT-1", patientId,
      drugId: "FENTANYL", simulationTimeSec: 0, mode: "BOLUS", route: "IV", vascularAccessId: "IV-1",
      dose: 100, doseUnit: "MCG" }, circulation);
    const snapshot = engine.snapshot(); const restored = new MedicationEngine(); restored.restore(snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.alsMedicationProjectionsAt(0)).toEqual(engine.alsMedicationProjectionsAt(0));
    expect(snapshot).toHaveProperty("norepinephrine");
    expect(snapshot).toHaveProperty("fluidTherapy");
    expect(snapshot).toHaveProperty("tranexamicAcid");
    expect(snapshot).toHaveProperty("analgesia");
  });

  test("ScenarioEngine uses authoritative rhythm/shock count and exposes detached assessment/debug evidence", () => {
    const engine = engineWithContext({ rhythm: "VF", rhythmClassification: "SHOCKABLE", shockAttemptCount: 3 });
    expect(engine.executeAlsMedicationCommand(command("AMIODARONE"))).toMatchObject({ status: "APPLIED",
      state: { protocolClassification: "GUIDELINE_ELIGIBLE", rhythmAtAdministration: "VF",
        shockCountAtAdministration: 3 } });
    expect(engine.getAssessmentSnapshot().clinicalFeatures).toContainEqual(expect.objectContaining({
      featureId: "AMIODARONE", profileId: "ERC_2025_ADULT_ALS", shockCountAtAdministration: 3,
    }));
    expect(getPatientResourceDebugSnapshot(patientId).medicationState?.clinicalFeatures)
      .toContainEqual(expect.objectContaining({ featureId: "AMIODARONE" }));
    const detached = engine.getAlsMedicationState().map(item => ({ ...item }));
    detached[0].dose = 999;
    expect(engine.getAlsMedicationState()[0].dose).toBe(300);
  });

  test("ScenarioEngine checkpoint preserves arrest course, rhythm evidence and projection exactly", () => {
    const engine = engineWithContext({ rhythm: "VF", rhythmClassification: "SHOCKABLE", shockAttemptCount: 5 });
    engine.executeAlsMedicationCommand(command("ADRENALINE"));
    engine.executeAlsMedicationCommand(command("AMIODARONE", 1));
    const payload = engine.captureRuntimePayload(); const restored = new ClinicalScenarioEngine();
    restored.rehydrateRuntimePayload(payload);
    expect(restored.captureRuntimePayload()).toEqual(payload);
    expect(restored.getAlsMedicationState()).toEqual(engine.getAlsMedicationState());
    expect(restored.captureRuntimePayload().processes.find(item => item.processType === "CARDIAC_ARREST")).toEqual(
      engine.captureRuntimePayload().processes.find(item => item.processType === "CARDIAC_ARREST"));
  });

  test("arrest medication and active mechanical ventilation coexist and rehydrate independently", () => {
    const source = engineWithContext({ rhythm: "PEA", rhythmClassification: "NON_SHOCKABLE" });
    const payload = source.captureRuntimePayload();
    const engine = new ClinicalScenarioEngine();
    engine.rehydrateRuntimePayload({ ...payload,
      interventionInstances: [...payload.interventionInstances, {
        instanceId: "ET-ALS", definitionId: "ENDOTRACHEAL_INTUBATION", definitionVersion: "1.0.0",
        definitionName: "Endotrahheaalne intubatsioon", encounterId: patientId, patientId, status: "RUNNING",
        startedAt: 0, parameters: { confirmation: true }, resourceIds: [], sourceInterventionId: "ET-ALS-SOURCE",
      }],
      airway: { states: [{ patientId, activeAirway: "ENDOTRACHEAL", currentVentilation: "NONE",
        confirmed: true, updatedAt: 0 }], events: [] },
    });
    expect(engine.executeMechanicalVentilationCommand({ commandId: "VENT-ALS", action: "START",
      supportId: "VENT-ALS", patientId, simulationTimeSec: 0, securedAirwayId: "ET-ALS", settings: {
        mode: "VOLUME_CONTROL", respiratoryRate: 12, respiratoryRateUnit: "BREATHS_MIN",
        tidalVolumeMl: 500, tidalVolumeUnit: "ML", fio2: 1, peepCmH2O: 5, peepUnit: "CM_H2O",
      } }).status).toBe("APPLIED");
    expect(engine.executeAlsMedicationCommand(command("ADRENALINE"))).toMatchObject({ status: "APPLIED" });
    const combined = engine.captureRuntimePayload(); const restored = new ClinicalScenarioEngine();
    restored.rehydrateRuntimePayload(combined);
    expect(restored.getMechanicalVentilationState()).toEqual(engine.getMechanicalVentilationState());
    expect(restored.getAlsMedicationState()).toEqual(engine.getAlsMedicationState());
    expect(restored.captureRuntimePayload()).toEqual(combined);
  });
});
