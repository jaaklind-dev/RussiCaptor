import type { ActiveClinicalTreatment, ClinicalTreatmentId } from "@/models/ClinicalTreatment";
import type { ClinicalFeatureProjection } from "@/models/ClinicalAssessment";
import { isClinicalTreatmentId, requireClinicalTreatmentDescriptor } from "./ClinicalTreatmentCatalog";

const text = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
const number = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;

function treatmentIdFor(projection: Readonly<Record<string, unknown>>): ClinicalTreatmentId | undefined {
  const candidate = text(projection.drugId) ?? text(projection.fluidType) ?? text(projection.featureId);
  return candidate && isClinicalTreatmentId(candidate) ? candidate : undefined;
}

function instanceIdFor(projection: Readonly<Record<string, unknown>>): string | undefined {
  return text(projection.administrationId) ?? text(projection.infusionId) ?? text(projection.regimenId) ??
    text(projection.supportId);
}

function lifecycleFor(projection: Readonly<Record<string, unknown>>): string {
  return text(projection.lifecycle) ?? text(projection.status) ??
    (projection.effectActive === true ? "ACTIVE" : "COMPLETED");
}

function details(treatmentId: ClinicalTreatmentId, projection: Readonly<Record<string, unknown>>): string[] {
  const lines: string[] = [];
  const mode = text(projection.mode); const route = text(projection.route);
  if (mode || route) lines.push([mode, route].filter(Boolean).join(" · "));
  const rate = number(projection.currentRateMlHour) ?? number(projection.currentRate) ??
    number(projection.doseMicrogramsPerKgMin);
  const rateUnit = text(projection.rateUnit) ?? text(projection.unit) ??
    (projection.currentRateMlHour !== undefined ? "ML_H" : undefined);
  if (rate !== undefined) lines.push(`Kiirus/annus: ${rate}${rateUnit ? ` ${rateUnit}` : ""}`);
  const delivered = number(projection.cumulativeDeliveredVolumeMl) ?? number(projection.deliveredDose);
  if (delivered !== undefined) lines.push(`Manustatud: ${delivered}`);
  if (treatmentId === "GELOFUSIN" && number(projection.effectiveIntravascularVolumeMl) !== undefined) {
    lines.push(`Efektiivne intravaskulaarne maht: ${number(projection.effectiveIntravascularVolumeMl)} ml`);
  }
  if (treatmentId === "TRANEXAMIC_ACID") lines.push(
    `Laadimine: ${number(projection.loadingDeliveredMg) ?? 0} mg`,
    `Säilitus: ${number(projection.maintenanceDeliveredMg) ?? 0} mg`,
  );
  if (treatmentId === "MECHANICAL_VENTILATION") lines.push(
    `RR ${number(projection.respiratoryRate)} · VT ${number(projection.tidalVolumeMl)} ml`,
    `FiO₂ ${number(projection.fio2)} · PEEP ${number(projection.peepCmH2O)} cmH₂O`,
    `Hingamistee: ${text(projection.securedAirwayId) ?? "–"}`,
  );
  const classification = text(projection.protocolClassification);
  if (classification) lines.push(`Protokoll: ${classification}`);
  const access = text(projection.vascularAccessId);
  if (access) lines.push(`Veenitee: ${access}`);
  return lines.filter(line => !line.includes("undefined"));
}

export function clinicalTreatmentProjections(features: readonly ClinicalFeatureProjection[], patientId: string):
readonly ActiveClinicalTreatment[] {
  return Object.freeze(features.flatMap(feature => {
    const projection = feature as unknown as Readonly<Record<string, unknown>>;
    if (text(projection.patientId) !== patientId) return [];
    const treatmentId = treatmentIdFor(projection); const instanceId = instanceIdFor(projection);
    if (!treatmentId || !instanceId) return [];
    const descriptor = requireClinicalTreatmentDescriptor(treatmentId);
    return [Object.freeze({ treatmentId, instanceId, patientId, displayName: descriptor.displayName,
      category: descriptor.category, lifecycle: lifecycleFor(projection), detailLines: Object.freeze(details(treatmentId,
        projection)), supportsChange: descriptor.supportsChange, supportsStop: descriptor.supportsStop,
      rawProjection: structuredClone(projection) })];
  }).sort((left, right) => left.displayName.localeCompare(right.displayName) ||
    left.instanceId.localeCompare(right.instanceId)));
}

export function isTreatmentActive(item: ActiveClinicalTreatment): boolean {
  return ["ACTIVE", "RUNNING", "STARTING", "STOPPING", "LOADING", "MAINTENANCE"].includes(item.lifecycle);
}
