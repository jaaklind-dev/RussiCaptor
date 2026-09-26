import type {
  ClinicalTreatmentBuildContext,
  ClinicalTreatmentCommand,
  ClinicalTreatmentDescriptor,
  ClinicalTreatmentFormValues,
  ClinicalTreatmentId,
  ClinicalTreatmentSubmissionResult,
} from "@/models/ClinicalTreatment";
import type { AlsMedicationCommand } from "@/models/AlsMedication";
import type { AnalgesicCommand } from "@/models/AnalgesiaMedication";
import type { SupportedFluidTherapyCommand } from "@/models/FluidTherapy";
import { getInstructorRuntimeOwner } from "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { runtimeWritesAllowed } from "@/services/runtime/persistence/RuntimeWriterAuthorityState";
import { getRuntimePatientCommandGateway, runtimePatientCommandSubmissionReadiness,
  submitPatientRuntimeCommand } from "@/services/runtime/commands/RuntimePatientCommandService";
import { canCurrentCaseManagerEditPatient, getCmOwnershipProjectionReadiness } from "@/services/AssignmentRepository";

export type ClinicalTreatmentBuildResult = Readonly<{ ok: true; command: ClinicalTreatmentCommand }> |
  Readonly<{ ok: false; errors: readonly string[] }>;

let sequence = 0;
export function createClinicalTreatmentIntentIdentity(treatmentId: ClinicalTreatmentId,
  patientId: string): Readonly<{ commandId: string; instanceId: string }> {
  sequence += 1;
  const nonce = `${Date.now()}-${sequence}`;
  return Object.freeze({ commandId: `TREATMENT-${patientId}-${treatmentId}-${nonce}`,
    instanceId: `TREATMENT-INSTANCE-${patientId}-${treatmentId}-${nonce}` });
}

function numberValue(values: ClinicalTreatmentFormValues, fieldId: keyof ClinicalTreatmentFormValues): number {
  const raw = values[fieldId]?.trim();
  if (!raw || !/^-?(?:\d+|\d*[.,]\d+)$/.test(raw)) return Number.NaN;
  return Number(raw.replace(",", "."));
}

export function validateClinicalTreatmentForm(descriptor: ClinicalTreatmentDescriptor,
  values: ClinicalTreatmentFormValues, action: ClinicalTreatmentBuildContext["action"] = "START"): readonly string[] {
  if (action === "STOP") return Object.freeze([]);
  const errors: string[] = [];
  for (const field of descriptor.fields) {
    if (action === "CHANGE") {
      const needed = descriptor.commandKind === "FLUID" ? field.fieldId === "rateMlHour" :
        descriptor.commandKind === "NOREPINEPHRINE" || descriptor.commandKind === "ANALGESIC" ?
          field.fieldId === "doseRate" : descriptor.commandKind === "VENTILATION";
      if (!needed) continue;
    }
    const value = values[field.fieldId] ?? field.initialValue;
    const mode = values.mode ?? descriptor.fields.find(item => item.fieldId === "mode")?.initialValue;
    if (field.fieldId === "volumeMl" && mode === "INFUSION") continue;
    if (field.fieldId === "dose" && mode === "INFUSION") continue;
    if (field.fieldId === "doseRate" && mode === "BOLUS") continue;
    if (field.kind === "SELECT") {
      if (field.required && !value) errors.push(`${field.label}: väärtus puudub`);
      if (field.fieldId !== "vascularAccessId" && field.fieldId !== "securedAirwayId" && value &&
        field.options?.length && !field.options.includes(value)) errors.push(`${field.label}: väärtus ei ole toetatud`);
      continue;
    }
    const parsed = numberValue({ ...values, [field.fieldId]: value }, field.fieldId);
    if (!Number.isFinite(parsed)) errors.push(`${field.label}: sisesta korrektne arv`);
    else if (field.minimum !== undefined && parsed < field.minimum ||
      field.maximum !== undefined && parsed > field.maximum) errors.push(`${field.label}: väärtus on lubatud piiridest väljas`);
  }
  return Object.freeze([...new Set(errors)]);
}

export function buildClinicalTreatmentCommand(descriptor: ClinicalTreatmentDescriptor,
  values: ClinicalTreatmentFormValues, context: ClinicalTreatmentBuildContext): ClinicalTreatmentBuildResult {
  values = { ...Object.fromEntries(descriptor.fields.filter(field => field.initialValue !== undefined)
    .map(field => [field.fieldId, field.initialValue!])), ...values };
  const action = context.action ?? "START";
  const errors = validateClinicalTreatmentForm(descriptor, values, action);
  if (errors.length) return Object.freeze({ ok: false, errors });
  const access = values.vascularAccessId;
  const route = (values.route ?? descriptor.routes[0]) as "IV" | "IO";
  const mode = (values.mode ?? descriptor.administrationModes[0]) as "BOLUS" | "INFUSION";
  const base = { commandId: context.commandId, patientId: context.patientId,
    simulationTimeSec: context.simulationTimeSec };
  if (descriptor.commandKind === "FLUID") return Object.freeze({ ok: true, command: Object.freeze({ kind: "FLUID",
    command: Object.freeze({ ...base, action: action === "CHANGE" ? "CHANGE_RATE" : action,
      administrationId: context.instanceId, fluidType: descriptor.treatmentId,
      ...(action === "START" ? { mode, prescribedVolumeMl: mode === "BOLUS" ? numberValue(values, "volumeMl") : undefined,
        volumeUnit: mode === "BOLUS" ? "ML" : undefined, vascularAccessId: access } : {}),
      ...(action !== "STOP" ? { rateMlHour: numberValue(values, "rateMlHour"), rateUnit: "ML_H" } : {}),
    } as SupportedFluidTherapyCommand) }) });
  if (descriptor.commandKind === "NOREPINEPHRINE") return Object.freeze({ ok: true,
    command: Object.freeze({ kind: "NOREPINEPHRINE", command: Object.freeze({ ...base,
      action: action === "CHANGE" ? "CHANGE_DOSE" : action, infusionId: context.instanceId,
      ...(action !== "STOP" ? { doseMicrogramsPerKgMin: numberValue(values, "doseRate"),
        unit: "MCG_KG_MIN" } : {}), ...(action === "START" ? { vascularAccessId: access } : {}),
    }) }) });
  if (descriptor.commandKind === "TXA") return Object.freeze({ ok: true, command: Object.freeze({ kind: "TXA",
    command: Object.freeze({ ...base, action: action === "STOP" ? "STOP" : "START",
      regimenId: context.instanceId, ...(action === "START" ? { vascularAccessId: access } : {}) }) }) });
  if (descriptor.commandKind === "ANALGESIC") return Object.freeze({ ok: true,
    command: Object.freeze({ kind: "ANALGESIC", command: Object.freeze({ ...base,
      action: action === "CHANGE" ? "CHANGE_RATE" : action, administrationId: context.instanceId,
      drugId: descriptor.treatmentId, ...(action === "START" ? { mode, route, vascularAccessId: access,
        ...(mode === "BOLUS" ? { dose: numberValue(values, "dose"),
          doseUnit: descriptor.fields.find(item => item.fieldId === "dose")?.unit } : {
          rate: numberValue(values, "doseRate"),
          rateUnit: descriptor.fields.find(item => item.fieldId === "doseRate")?.unit }) } : {}),
      ...(action === "CHANGE" ? { rate: numberValue(values, "doseRate"),
        rateUnit: descriptor.fields.find(item => item.fieldId === "doseRate")?.unit } : {}),
    } as AnalgesicCommand) }) });
  if (descriptor.commandKind === "MEDICATION") return Object.freeze({ ok: true,
    command: Object.freeze({ kind: "MEDICATION", command: Object.freeze({ commandId: context.commandId,
      administrationId: context.instanceId, medicationId: descriptor.treatmentId, patientId: context.patientId,
      route, dose: numberValue(values, "dose"), unit: descriptor.fields.find(item => item.fieldId === "dose")!.unit!,
      timestamp: context.simulationTimeSec, administrator: "CLINICAL_TREATMENT", vascularAccessId: access }) }) });
  if (descriptor.commandKind === "VENTILATION") return Object.freeze({ ok: true,
    command: Object.freeze({ kind: "VENTILATION", command: Object.freeze({ ...base,
      action: action === "CHANGE" ? "CHANGE_SETTINGS" : action, supportId: context.instanceId,
      ...(action !== "STOP" ? { securedAirwayId: values.securedAirwayId, settings: Object.freeze({
        mode: "VOLUME_CONTROL" as const, respiratoryRate: numberValue(values, "respiratoryRate"),
        respiratoryRateUnit: "BREATHS_MIN" as const, tidalVolumeMl: numberValue(values, "tidalVolumeMl"),
        tidalVolumeUnit: "ML" as const, fio2: numberValue(values, "fio2"),
        peepCmH2O: numberValue(values, "peepCmH2O"), peepUnit: "CM_H2O" as const,
      }) } : {}) }) }) });
  const productDoseUnit = descriptor.fields.find(item => item.fieldId === "dose")!.unit!;
  return Object.freeze({ ok: true, command: Object.freeze({ kind: "ALS", command: Object.freeze({ ...base,
    administrationId: context.instanceId, drugId: descriptor.treatmentId, route,
    vascularAccessId: access!, dose: numberValue(values, "dose"), doseUnit: productDoseUnit,
    ...(descriptor.treatmentId === "CALCIUM_CHLORIDE" ? {
      concentrationId: "CALCIUM_CHLORIDE_10_PERCENT" as const,
    } : {}),
  } as AlsMedicationCommand) }) });
}

function resultMessage(status: string, rejectionReason?: string, protocolClassification?: string): string {
  const protocolLabels: Readonly<Record<string, string>> = Object.freeze({
    GUIDELINE_ELIGIBLE: "juhendi järgi sobiv", OVERDUE_GUIDELINE_ELIGIBLE: "hilinenud, kuid sobiv",
    TOO_EARLY_FOR_SHOCKABLE_ALGORITHM: "šokialgoritmi jaoks liiga vara", REPEAT_TOO_SOON: "kordus liiga vara",
    OUTSIDE_CARDIAC_ARREST_CONTEXT: "väljaspool südameseiskuse konteksti", WRONG_RHYTHM: "rütm ei sobi",
    WRONG_SHOCK_COUNT: "šokkide arv ei sobi", INAPPROPRIATE_IN_CARDIAC_ARREST: "südameseiskuse korral sobimatu",
    SPECIFIC_INDICATION_REQUIRED: "vajab konkreetset näidustust", SUBSTRATE_UNMODELED: "näidustuse alus pole mudeldatud",
  });
  if (status === "APPLIED") return protocolClassification ?
    `Ravi rakendati · ${protocolLabels[protocolClassification] ?? protocolClassification.toLowerCase().replaceAll("_", " ")}` :
    "Ravi rakendati.";
  if (status === "IDEMPOTENT" || status === "NO_OP") return "Ravi oli juba rakendatud.";
  return rejectionReason ? "Ravi lükati tehnilise kontrolli tõttu tagasi. Vaata sisestatud väärtused üle." :
    "Ravi lükati tagasi.";
}

export function clinicalTreatmentMutationReadiness(exerciseId: string, patientId: string):
Readonly<{ ready: boolean; reason?: string }> {
  const ownership = getCmOwnershipProjectionReadiness(exerciseId);
  if (ownership.managed && (!ownership.ready || !canCurrentCaseManagerEditPatient(patientId))) {
    return Object.freeze({ ready: false, reason: ownership.ready
      ? "Patsiendi vastutus ei kuulu sellele CM-ile."
      : "Patsiendi vastutust sünkroonitakse." });
  }
  if (getRuntimePatientCommandGateway()) {
    return runtimePatientCommandSubmissionReadiness(exerciseId);
  }
  if (!runtimeWritesAllowed()) {
    return Object.freeze({ ready: false, reason: "Ravikorralduse saatmine ei ole ühendatud." });
  }
  if (!getInstructorRuntimeOwner(exerciseId, patientId)?.executeClinicalTreatment) {
    return Object.freeze({ ready: false, reason: "Patsiendi Runtime ei ole ravikorralduseks valmis." });
  }
  return Object.freeze({ ready: true });
}

export async function submitClinicalTreatment(exerciseId: string, patientId: string,
  treatmentId: ClinicalTreatmentId, command: ClinicalTreatmentCommand): Promise<ClinicalTreatmentSubmissionResult> {
  if (getRuntimePatientCommandGateway()) {
    const submitted = await submitPatientRuntimeCommand({ exerciseId, patientId,
      commandId: command.command.commandId, commandType: "CLINICAL_TREATMENT",
      simulationTimeSec: "simulationTimeSec" in command.command ? command.command.simulationTimeSec : command.command.timestamp,
      payload: Object.freeze({ treatmentId, command }) });
    if (submitted.status === "APPLIED" || submitted.status === "IDEMPOTENT") {
      return Object.freeze({ treatmentId, status: "APPLIED", message: "Ravikorraldus võeti autoritaarsesse tööjärjekorda." });
    }
    return Object.freeze({ treatmentId, status: "UNAVAILABLE",
      message: submitted.status === "STALE_VERSION" || submitted.status === "NOT_OWNER"
        ? "Patsiendi vastutus või seis muutus. Värskenda vaadet ja proovi uuesti."
        : submitted.status === "COMPLETION_FENCED" || submitted.status === "EXERCISE_NOT_ACTIVE"
          ? "Õppust lõpetatakse või see on juba lõppenud."
          : "Ravikorraldust ei saanud autoritaarsesse tööjärjekorda saata." });
  }
  return applyClinicalTreatmentLocally(exerciseId, patientId, treatmentId, command);
}

export function applyClinicalTreatmentLocally(exerciseId: string, patientId: string,
  treatmentId: ClinicalTreatmentId, command: ClinicalTreatmentCommand,
  acceptedDurableSimulationTimeSec?: number): ClinicalTreatmentSubmissionResult {
  const owner = getInstructorRuntimeOwner(exerciseId, patientId);
  if (!runtimeWritesAllowed() || !owner?.executeClinicalTreatment) return Object.freeze({ treatmentId,
    status: "UNAVAILABLE", message: "Ravikorraldust ei saa praegu autoriteetselt rakendada." });
  const runtimeResult = owner.executeClinicalTreatment(command, acceptedDurableSimulationTimeSec);
  const state = runtimeResult.state as Readonly<{ protocolClassification?: string }> | undefined;
  const protocolClassification = state?.protocolClassification;
  const rejectionReason = runtimeResult.rejectionReason;
  return Object.freeze({ treatmentId, status: runtimeResult.status,
    message: resultMessage(runtimeResult.status, rejectionReason, protocolClassification),
    ...(protocolClassification ? { protocolClassification } : {}),
    ...(rejectionReason ? { rejectionReason } : {}), runtimeResult: structuredClone(runtimeResult) });
}
