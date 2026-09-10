import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import { ClinicalTreatmentPanel } from "@/components/patient/ClinicalTreatmentPanel";
import type { ClinicalFeatureProjection } from "@/models/ClinicalAssessment";
import type {
  ClinicalTreatmentCommand,
  ClinicalTreatmentFormValues,
  ClinicalTreatmentId,
} from "@/models/ClinicalTreatment";
import type { CirculationState } from "@/models/CirculationState";
import type { CardiacArrestPatientProcessRuntime } from "@/models/PatientProcessRuntime";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import {
  availableClinicalTreatmentDescriptors,
  getClinicalTreatmentCatalog,
  groupClinicalTreatments,
  requireClinicalTreatmentDescriptor,
} from "@/services/clinical/ClinicalTreatmentCatalog";
import {
  buildClinicalTreatmentCommand,
  clinicalTreatmentMutationReadiness,
  submitClinicalTreatment,
  validateClinicalTreatmentForm,
} from "@/services/clinical/ClinicalTreatmentCommandService";
import { clinicalTreatmentProjections } from "@/services/clinical/ClinicalTreatmentProjection";
import { DEFAULT_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { createExercisePackage } from "@/services/exercise/ExercisePackageHash";
import { exercisePackageValidator } from "@/services/exercise/ExercisePackageService";
import { CARDIAC_ARREST_REFERENCE_FIXTURE } from "@/services/golden/CardiacArrestReferenceFixture";
import { publishResourceRuntimeDebugSnapshot } from "@/services/ResourceRuntimeDebugService";
import { clearInstructorRuntimeOwners, registerInstructorRuntimeOwner } from
  "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { createScenarioEngineInstructorRuntimeOwner } from
  "@/services/runtime/instructor/ScenarioEngineInstructorRuntimeOwner";
import { setRuntimeWriterAuthorityState } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";

const patientId = "PT-CARDIAC-REFERENCE";
const circulation: CirculationState = { patientId, vascularAccess: [
  { interventionInstanceId: "IV-1", type: "PERIPHERAL_IV", resourceIds: ["PIV-1"], establishedAt: 0 },
  { interventionInstanceId: "IO-1", type: "IO", resourceIds: ["IO-1"], establishedAt: 0 },
], hemorrhageControl: [], runningInfusions: [], updatedAt: 0 };

const context = (action: "START" | "CHANGE" | "STOP" = "START", instanceId = "INSTANCE-1") => ({
  patientId, simulationTimeSec: 0, commandId: `COMMAND-${action}-${instanceId}`, instanceId, action,
} as const);

function build(treatmentId: ClinicalTreatmentId, values: ClinicalTreatmentFormValues,
  action: "START" | "CHANGE" | "STOP" = "START", instanceId?: string) {
  return buildClinicalTreatmentCommand(requireClinicalTreatmentDescriptor(treatmentId), values,
    context(action, instanceId));
}

function cardiacEngine(overrides: Partial<CardiacArrestPatientProcessRuntime["clinicalState"]> = {}) {
  const source = new ClinicalScenarioEngine(); source.reset(CARDIAC_ARREST_REFERENCE_FIXTURE);
  const payload = source.captureRuntimePayload();
  const processes = payload.processes.map(item => item.processType !== "CARDIAC_ARREST" ? item : ({ ...item,
    clinicalState: { ...item.clinicalState, ...overrides } } as CardiacArrestPatientProcessRuntime));
  const engine = new ClinicalScenarioEngine(); engine.rehydrateRuntimePayload({ ...payload, processes,
    circulation: { states: [circulation], events: [] } }); return engine;
}

function engineWithSecuredAirway() {
  const source = cardiacEngine(); const payload = source.captureRuntimePayload(); const engine = new ClinicalScenarioEngine();
  engine.rehydrateRuntimePayload({ ...payload, interventionInstances: [...payload.interventionInstances, {
    instanceId: "ET-1", definitionId: "ENDOTRACHEAL_INTUBATION", definitionVersion: "1.0.0",
    definitionName: "Endotrahheaalne intubatsioon", encounterId: patientId, patientId, status: "RUNNING",
    startedAt: 0, parameters: { confirmation: true }, resourceIds: [], sourceInterventionId: "ET-SOURCE",
  }], airway: { states: [{ patientId, activeAirway: "ENDOTRACHEAL", currentVentilation: "NONE",
    confirmed: true, updatedAt: 0 }], events: [] } });
  return engine;
}

function executeBuilt(engine: ClinicalScenarioEngine, result: ReturnType<typeof build>): void {
  if (!result.ok) throw new Error(result.errors.join(","));
  const request = result.command;
  if (request.kind === "FLUID") engine.executeFluidTherapyCommand(request.command);
  else if (request.kind === "NOREPINEPHRINE") engine.executeNorepinephrineCommand(request.command);
  else if (request.kind === "TXA") engine.executeTranexamicAcidCommand(request.command);
  else if (request.kind === "ANALGESIC") engine.executeAnalgesicCommand(request.command);
  else if (request.kind === "VENTILATION") engine.executeMechanicalVentilationCommand(request.command);
  else if (request.kind === "MEDICATION") engine.executeMedicationCommand(request.command);
  else engine.executeAlsMedicationCommand(request.command);
}

function packageContent() {
  const { packageHash: _packageHash, manifest: _manifest, ...content } = structuredClone(DEFAULT_EXERCISE_PACKAGE);
  return content;
}

describe("Clinical Treatment descriptor catalog and scenario availability", () => {
  test("contains exactly one descriptor for every accepted canonical treatment", () => {
    const catalog = getClinicalTreatmentCatalog();
    expect(catalog).toHaveLength(27);
    expect(new Set(catalog.map(item => item.treatmentId)).size).toBe(27);
    expect(catalog.map(item => item.treatmentId)).toEqual(expect.arrayContaining([
      "RINGER", "SODIUM_CHLORIDE_0_9", "GELOFUSIN", "TRANEXAMIC_ACID", "NOREPINEPHRINE",
      "MECHANICAL_VENTILATION", "ADRENALINE", "AMIODARONE", "LIDOCAINE", "ATROPINE", "ADENOSINE",
      "MAGNESIUM_SULFATE", "CALCIUM_CHLORIDE", "SODIUM_BICARBONATE",
      "FIBRINOGEN_CONCENTRATE", "PROPOFOL", "MIDAZOLAM", "ROCURONIUM",
    ]));
  });

  test("keeps aliases display-only and never creates DOLMEN as a second treatment", () => {
    const catalog = getClinicalTreatmentCatalog();
    expect(catalog.some(item => item.treatmentId === ("DOLMEN" as ClinicalTreatmentId))).toBe(false);
    expect(catalog.find(item => item.treatmentId === "DEXKETOPROFEN")).toMatchObject({
      displayName: "Dexketoprofen (Dolmen)", aliases: ["DOLMEN"],
    });
    expect(catalog.find(item => item.treatmentId === "SODIUM_CHLORIDE_0_9")?.displayName).toBe("NaCl 0.9%");
  });

  test("groups descriptors into clinician-facing categories", () => {
    expect([...groupClinicalTreatments(getClinicalTreatmentCatalog()).keys()]).toEqual([
      "FLUIDS", "HEMOSTASIS", "ANALGESIA", "SEDATION", "NEUROMUSCULAR_BLOCKADE",
      "VASOACTIVE", "RESPIRATORY_SUPPORT", "ALS_MEDICATIONS",
    ]);
  });

  test("uses the complete supported palette as the historical no-configuration fallback", () => {
    expect(availableClinicalTreatmentDescriptors({}).map(item => item.treatmentId))
      .toEqual(getClinicalTreatmentCatalog().map(item => item.treatmentId));
  });

  test("filters a trauma scenario and excludes normal ALS selector entries", () => {
    const trauma = ["RINGER", "SODIUM_CHLORIDE_0_9", "GELOFUSIN", "TRANEXAMIC_ACID", "FENTANYL",
      "KETAMINE", "NOREPINEPHRINE", "MECHANICAL_VENTILATION"] as const;
    expect(availableClinicalTreatmentDescriptors({ availableClinicalTreatments: trauma })
      .map(item => item.treatmentId)).toEqual(trauma);
  });

  test("filters an ALS scenario and excludes trauma treatments outside its palette", () => {
    const als = ["MECHANICAL_VENTILATION", "ADRENALINE", "AMIODARONE", "LIDOCAINE", "ATROPINE",
      "ADENOSINE", "MAGNESIUM_SULFATE", "CALCIUM_CHLORIDE", "SODIUM_BICARBONATE"] as const;
    const result = availableClinicalTreatmentDescriptors({ availableClinicalTreatments: als });
    expect(result.map(item => item.treatmentId)).toEqual(expect.arrayContaining([...als]));
    expect(result.some(item => item.treatmentId === "RINGER")).toBe(false);
  });

  test("includes availability in a new package hash without changing historical package hashes", () => {
    const historicalHash = DEFAULT_EXERCISE_PACKAGE.packageHash;
    const limited = createExercisePackage({ ...packageContent(),
      availableClinicalTreatments: ["RINGER", "TRANEXAMIC_ACID"] });
    expect(limited.packageHash).not.toBe(historicalHash);
    expect(DEFAULT_EXERCISE_PACKAGE.packageHash).toBe(historicalHash);
    expect(exercisePackageValidator.validate(limited)).toEqual([]);
  });

  test("fails closed for unknown and duplicate configured treatment IDs", () => {
    const invalid = createExercisePackage({ ...packageContent(),
      packageId: "clinical-ui.invalid", packageVersion: "1.0.0",
      definition: { ...structuredClone(DEFAULT_EXERCISE_PACKAGE.definition),
        exerciseTypeId: "CLINICAL_UI_INVALID" },
      availableClinicalTreatments: ["RINGER", "RINGER", "UNKNOWN" as ClinicalTreatmentId] });
    expect(exercisePackageValidator.validate(invalid).map(item => item.code)).toEqual(expect.arrayContaining([
      "DUPLICATE_VALUE", "INVALID_CLINICAL_TREATMENT",
    ]));
  });
});

describe("Clinical Treatment generic command construction", () => {
  test("builds a Ringer bolus with normalized volume/rate units", () => {
    expect(build("RINGER", { mode: "BOLUS", volumeMl: "500", rateMlHour: "1000",
      vascularAccessId: "IV-1" })).toMatchObject({ ok: true, command: { kind: "FLUID", command: {
        action: "START", fluidType: "RINGER", prescribedVolumeMl: 500, volumeUnit: "ML", rateMlHour: 1000,
        rateUnit: "ML_H", vascularAccessId: "IV-1",
      } } });
  });

  test.each(["SODIUM_CHLORIDE_0_9", "GELOFUSIN"] as const)("builds %s infusion", treatmentId => {
    expect(build(treatmentId, { mode: "INFUSION", rateMlHour: "250,5", vascularAccessId: "IO-1" }))
      .toMatchObject({ ok: true, command: { kind: "FLUID", command: { fluidType: treatmentId,
        mode: "INFUSION", rateMlHour: 250.5, vascularAccessId: "IO-1" } } });
  });

  test("builds the automatic TXA course without manual dose fields", () => {
    expect(requireClinicalTreatmentDescriptor("TRANEXAMIC_ACID").fields.map(item => item.fieldId))
      .toEqual(["vascularAccessId"]);
    expect(build("TRANEXAMIC_ACID", { vascularAccessId: "IV-1" })).toMatchObject({ ok: true,
      command: { kind: "TXA", command: { action: "START", vascularAccessId: "IV-1" } } });
  });

  test("builds canonical Fibryga as 5 g IV fibrinogen concentrate", () => {
    expect(requireClinicalTreatmentDescriptor("FIBRINOGEN_CONCENTRATE")).toMatchObject({
      displayName: "Fibrinogeenikontsentraat (Fibryga)", aliases: ["FIBRYGA"], routes: ["IV"],
    });
    expect(build("FIBRINOGEN_CONCENTRATE", { dose: "5", route: "IV", vascularAccessId: "IV-1" }))
      .toMatchObject({ ok: true, command: { kind: "MEDICATION", command: {
        medicationId: "FIBRINOGEN_CONCENTRATE", dose: 5, unit: "G", route: "IV",
        vascularAccessId: "IV-1",
      } } });
  });

  test.each([
    ["FENTANYL", { mode: "BOLUS", route: "IV", vascularAccessId: "IV-1", dose: "100" }, "MCG"],
    ["KETAMINE", { mode: "BOLUS", route: "IO", vascularAccessId: "IO-1", dose: "50" }, "MG"],
    ["PARACETAMOL", { mode: "BOLUS", route: "IV", vascularAccessId: "IV-1", dose: "1000" }, "MG"],
    ["DEXKETOPROFEN", { mode: "BOLUS", route: "IV", vascularAccessId: "IV-1", dose: "50" }, "MG"],
  ] as const)("builds %s bolus from product metadata", (treatmentId, values, unit) => {
    expect(build(treatmentId, values)).toMatchObject({ ok: true, command: { kind: "ANALGESIC", command: {
      drugId: treatmentId, doseUnit: unit,
    } } });
  });

  test("builds remifentanil infusion and rate change", () => {
    const values = { mode: "INFUSION", route: "IV", vascularAccessId: "IV-1", doseRate: "5" };
    expect(build("REMIFENTANIL", values)).toMatchObject({ command: { command: { action: "START",
      rate: 5, rateUnit: "MCG_MIN" } } });
    expect(build("REMIFENTANIL", { doseRate: "8" }, "CHANGE", "REM-1"))
      .toMatchObject({ command: { command: { action: "CHANGE_RATE", administrationId: "REM-1", rate: 8 } } });
  });

  test("builds norepinephrine start/change/stop commands", () => {
    expect(build("NOREPINEPHRINE", { doseRate: "0.1", vascularAccessId: "IV-1" }))
      .toMatchObject({ command: { command: { action: "START", doseMicrogramsPerKgMin: 0.1,
        unit: "MCG_KG_MIN" } } });
    expect(build("NOREPINEPHRINE", { doseRate: "0.2" }, "CHANGE", "NE-1"))
      .toMatchObject({ command: { command: { action: "CHANGE_DOSE", infusionId: "NE-1" } } });
    expect(build("NOREPINEPHRINE", {}, "STOP", "NE-1"))
      .toMatchObject({ command: { command: { action: "STOP", infusionId: "NE-1" } } });
  });

  test("builds only supported volume-control ventilation settings and stop", () => {
    const values = { securedAirwayId: "ET-1", respiratoryRate: "14", tidalVolumeMl: "500", fio2: "0,8",
      peepCmH2O: "5" };
    expect(build("MECHANICAL_VENTILATION", values)).toMatchObject({ command: { kind: "VENTILATION",
      command: { action: "START", securedAirwayId: "ET-1", settings: { mode: "VOLUME_CONTROL",
        respiratoryRate: 14, tidalVolumeMl: 500, fio2: 0.8, peepCmH2O: 5 } } } });
    expect(build("MECHANICAL_VENTILATION", {}, "STOP", "VENT-1"))
      .toMatchObject({ command: { command: { action: "STOP", supportId: "VENT-1" } } });
  });

  test.each(["ADRENALINE", "AMIODARONE", "ADENOSINE", "CALCIUM_CHLORIDE", "SODIUM_BICARBONATE"] as const)(
    "builds technically valid %s input without pre-blocking clinical appropriateness", treatmentId => {
      const descriptor = requireClinicalTreatmentDescriptor(treatmentId);
      const values = { dose: descriptor.fields.find(item => item.fieldId === "dose")!.initialValue,
        route: descriptor.routes[0], vascularAccessId: "IV-1" };
      const result = build(treatmentId, values);
      expect(result).toMatchObject({ ok: true, command: { kind: "ALS", command: { drugId: treatmentId } } });
      if (treatmentId === "CALCIUM_CHLORIDE") expect(result).toMatchObject({ command: { command: {
        concentrationId: "CALCIUM_CHLORIDE_10_PERCENT" } } });
    });

  test("blocks malformed technical input before command creation", () => {
    const descriptor = requireClinicalTreatmentDescriptor("RINGER");
    expect(validateClinicalTreatmentForm(descriptor, { mode: "BOLUS", volumeMl: "five hundred",
      rateMlHour: "999999", vascularAccessId: "" })).toEqual(expect.arrayContaining([
        expect.stringContaining("korrektne arv"), expect.stringContaining("piiridest"),
        expect.stringContaining("väärtus puudub"),
      ]));
  });

  test.each([
    ["RINGER", "CHANGE", { rateMlHour: "500" }, "CHANGE_RATE"],
    ["RINGER", "STOP", {}, "STOP"],
    ["TRANEXAMIC_ACID", "STOP", {}, "STOP"],
  ] as const)("builds active-management command for %s %s", (id, action, values, runtimeAction) => {
    expect(build(id, values, action, "ACTIVE-1")).toMatchObject({ ok: true,
      command: { command: { action: runtimeAction } } });
  });
});

describe("Clinical Treatment authoritative integration and projections", () => {
  beforeEach(() => { clearInstructorRuntimeOwners(); setRuntimeWriterAuthorityState("UNRESOLVED"); });

  test("submits a technically valid but too-early shockable adrenaline action to Runtime", async () => {
    const engine = cardiacEngine({ rhythm: "VF", rhythmClassification: "SHOCKABLE", shockAttemptCount: 2 });
    const exerciseId = "CLINICAL-TREATMENT-INTEGRATION";
    registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patientId));
    const built = build("ADRENALINE", { dose: "1", route: "IV", vascularAccessId: "IV-1" });
    expect(built.ok).toBe(true);
    const result = await submitClinicalTreatment(exerciseId, patientId, "ADRENALINE",
      (built as { ok: true; command: ClinicalTreatmentCommand }).command);
    expect(result).toMatchObject({ status: "APPLIED", protocolClassification:
      "TOO_EARLY_FOR_SHOCKABLE_ALGORITHM" });
    expect(engine.getAlsMedicationState()).toContainEqual(expect.objectContaining({
      protocolClassification: "TOO_EARLY_FOR_SHOCKABLE_ALGORITHM",
    }));
  });

  test("fails closed without writer authority and does not pretend submission succeeded", async () => {
    const exerciseId = "READ-ONLY"; const engine = cardiacEngine();
    registerInstructorRuntimeOwner(createScenarioEngineInstructorRuntimeOwner(engine, exerciseId, patientId));
    setRuntimeWriterAuthorityState("READER");
    expect(clinicalTreatmentMutationReadiness(exerciseId, patientId)).toMatchObject({ ready: false });
    const built = build("ADRENALINE", { dose: "1", route: "IV", vascularAccessId: "IV-1" });
    await expect(submitClinicalTreatment(exerciseId, patientId, "ADRENALINE",
      (built as { ok: true; command: ClinicalTreatmentCommand }).command)).resolves.toMatchObject({
        status: "UNAVAILABLE",
      });
    expect(engine.getAlsMedicationState()).toEqual([]);
  });

  test("normalizes active cards while keeping historical treatments outside the current palette visible", () => {
    const features: ClinicalFeatureProjection[] = [{ featureId: "RINGER", administrationId: "R-1", patientId, fluidType: "RINGER",
      fluidClass: "CRYSTALLOID", mode: "INFUSION", status: "RUNNING", vascularAccessId: "IV-1",
      currentRateMlHour: 500, cumulativeDeliveredVolumeMl: 100, effectiveIntravascularVolumeMl: 25,
      startedAtSimulationTimeSec: 0, lastRateChangeAtSimulationTimeSec: 0 },
    { featureId: "ADRENALINE", administrationId: "A-1", patientId, drugId: "ADRENALINE", route: "IV",
      vascularAccessId: "IV-1", protocolClassification: "TOO_EARLY_FOR_SHOCKABLE_ALGORITHM" }] as never;
    const projected = clinicalTreatmentProjections(features, patientId);
    expect(projected.map(item => item.treatmentId)).toEqual(["ADRENALINE", "RINGER"]);
    expect(availableClinicalTreatmentDescriptors({ availableClinicalTreatments: ["RINGER"] }))
      .toHaveLength(1);
    expect(projected.find(item => item.treatmentId === "ADRENALINE")?.detailLines)
      .toContain("Protokoll: TOO_EARLY_FOR_SHOCKABLE_ALGORITHM");
  });

  test("reconstructs the same cards after detached projection rehydration without phantom pending state", () => {
    const features: ClinicalFeatureProjection[] = [{ featureId: "NOREPINEPHRINE", infusionId: "NE-1", patientId, route: "IV",
      vascularAccessId: "IV-1", status: "RUNNING", doseMicrogramsPerKgMin: 0.1, unit: "MCG_KG_MIN",
      startedAtSimulationTimeSec: 0, lastDoseChangeAtSimulationTimeSec: 0 }] as never;
    expect(clinicalTreatmentProjections(structuredClone(features), patientId))
      .toEqual(clinicalTreatmentProjections(features, patientId));
  });

  test("reconstructs mixed authoritative treatment cards after Runtime checkpoint rehydrate", () => {
    const engine = engineWithSecuredAirway();
    executeBuilt(engine, build("RINGER", { mode: "INFUSION", rateMlHour: "500", vascularAccessId: "IV-1" },
      "START", "RINGER-1"));
    executeBuilt(engine, build("NOREPINEPHRINE", { doseRate: "0.1", vascularAccessId: "IV-1" },
      "START", "NE-1"));
    executeBuilt(engine, build("TRANEXAMIC_ACID", { vascularAccessId: "IV-1" }, "START", "TXA-1"));
    executeBuilt(engine, build("FENTANYL", { mode: "BOLUS", route: "IV", vascularAccessId: "IV-1",
      dose: "100" }, "START", "FENT-1"));
    executeBuilt(engine, build("REMIFENTANIL", { mode: "INFUSION", route: "IV", vascularAccessId: "IV-1",
      doseRate: "5" }, "START", "REM-1"));
    executeBuilt(engine, build("MECHANICAL_VENTILATION", { securedAirwayId: "ET-1", respiratoryRate: "14",
      tidalVolumeMl: "500", fio2: "0.8", peepCmH2O: "5" }, "START", "VENT-1"));
    executeBuilt(engine, build("ADRENALINE", { dose: "1", route: "IV", vascularAccessId: "IV-1" },
      "START", "ADR-1"));
    const before = clinicalTreatmentProjections(engine.getAssessmentSnapshot().clinicalFeatures ?? [], patientId);
    const restored = new ClinicalScenarioEngine(); restored.rehydrateRuntimePayload(engine.captureRuntimePayload());
    const after = clinicalTreatmentProjections(restored.getAssessmentSnapshot().clinicalFeatures ?? [], patientId);
    expect(after).toEqual(before);
    expect(after.map(item => item.treatmentId)).toEqual(expect.arrayContaining(["RINGER", "NOREPINEPHRINE",
      "TRANEXAMIC_ACID", "FENTANYL", "REMIFENTANIL", "MECHANICAL_VENTILATION", "ADRENALINE"]));
  });

  test("projects TXA phase, analgesic infusion and ventilation settings without recomputing physiology", () => {
    const features: ClinicalFeatureProjection[] = [{ featureId: "TRANEXAMIC_ACID", regimenId: "TXA-1",
      patientId, category: "ANTIFIBRINOLYTIC", route: "IV", vascularAccessId: "IV-1",
      lifecycle: "MAINTENANCE", loadingStatus: "COMPLETED", maintenanceStatus: "RUNNING",
      loadingDeliveredMg: 1000, maintenanceDeliveredMg: 200, startedAtSimulationTimeSec: 0,
      phaseTransitionAtSimulationTimeSec: 600, timingClassification: "WITHIN_WINDOW",
      currentAntifibrinolyticEffect: 1 }, { featureId: "ANALGESIA", administrationId: "REM-1", patientId,
      drugId: "REMIFENTANIL", displayName: "Remifentanil", aliases: [], drugClass: "OPIOID", route: "IV",
      vascularAccessId: "IV-1", mode: "INFUSION", lifecycle: "RUNNING", currentRate: 5,
      rateUnit: "MCG_MIN", deliveredDose: 10, startedAtSimulationTimeSec: 0,
      lastRateChangeAtSimulationTimeSec: 0, normalizedExposure: 0.2, baselinePainIntensity: 8,
      currentPainIntensity: 7, analgesia: 0.2, sedation: 0.1, respiratoryDepression: 0.1, dissociation: 0,
      sympatheticEffect: 0, hemodynamicDepression: 0, antiInflammatoryAnalgesia: 0 },
    { featureId: "MECHANICAL_VENTILATION", supportId: "VENT-1", patientId, securedAirwayId: "ET-1",
      mode: "VOLUME_CONTROL", lifecycle: "RUNNING", airwayValid: true, externalSupportActive: true,
      respiratoryRate: 14, respiratoryRateUnit: "BREATHS_MIN", tidalVolumeMl: 500, tidalVolumeUnit: "ML",
      mechanicalMinuteVentilationLMin: 7, fio2: 0.8, peepCmH2O: 5, peepUnit: "CM_H2O",
      peepPhysiologicEffect: "DEFERRED_NO_GENERIC_RECRUITMENT_MODEL", medicationRespiratoryDepression: 0,
      effectiveRespiratoryRate: 14, startedAtSimulationTimeSec: 0, lastSettingsChangeAtSimulationTimeSec: 0 }];
    const projected = clinicalTreatmentProjections(features, patientId);
    expect(projected).toHaveLength(3);
    expect(projected.find(item => item.treatmentId === "TRANEXAMIC_ACID")?.detailLines)
      .toEqual(expect.arrayContaining(["Laadimine: 1000 mg", "Säilitus: 200 mg"]));
    expect(projected.find(item => item.treatmentId === "REMIFENTANIL")?.detailLines)
      .toContain("Kiirus/annus: 5 MCG_MIN");
    expect(projected.find(item => item.treatmentId === "MECHANICAL_VENTILATION")?.detailLines)
      .toContain("RR 14 · VT 500 ml");
  });

  test("catalog and projection reads do not mutate accepted Runtime clinical output", () => {
    const engine = cardiacEngine(); const before = engine.captureRuntimePayload();
    getClinicalTreatmentCatalog(); availableClinicalTreatmentDescriptors({});
    clinicalTreatmentProjections(engine.getAssessmentSnapshot().clinicalFeatures ?? [], patientId);
    expect(engine.captureRuntimePayload()).toEqual(before);
  });

  test("coalesces rapid submit presses into one command intent", async () => {
    const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
    registerInstructorRuntimeOwner({ exerciseId, patientId, supportedEvents: [], execute: () => ({ ok: false,
      reason: "unused" }), executeClinicalTreatment: request => ({ status: "APPLIED",
        commandId: request.command.commandId }) });
    publishResourceRuntimeDebugSnapshot({ resources: [], activeInterventions: [], clinicalInterventions: [],
      airwayStates: [], circulationStates: [circulation], medicationState: { instances: [], events: [], effects: [],
        clinicalFeatures: [] }, recentEvents: [], updatedAt: 0 }, patientId);
    let settle!: () => void; const pending = new Promise<void>(resolve => { settle = resolve; });
    const onSubmit = jest.fn(async (treatmentId: ClinicalTreatmentId) => { await pending; return {
      treatmentId, status: "APPLIED" as const, message: "Ravi rakendati.",
    }; });
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<ClinicalTreatmentPanel patientId={patientId}
      exercisePackage={{ availableClinicalTreatments: ["RINGER"] }} onSubmit={onSubmit} />); });
    await act(async () => renderer.root.findByProps({ accessibilityRole: "button" }).props.onPress());
    await act(async () => {
      renderer.root.findByProps({ testID: "treatment-field-volumeMl" }).props.onChangeText("500");
      renderer.root.findByProps({ testID: "treatment-field-rateMlHour" }).props.onChangeText("1000");
      renderer.root.findByProps({ testID: "treatment-choice-vascularAccessId-IV-1" }).props.onPress();
    });
    const submit = renderer.root.findByProps({ testID: "submit-treatment" });
    await act(async () => { submit.props.onPress(); submit.props.onPress(); submit.props.onPress();
      await Promise.resolve(); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => { settle(); await pending; });
  });
});
