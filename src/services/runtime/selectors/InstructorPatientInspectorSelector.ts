import type { InstructorPatientStatus } from "@/models/InstructorDashboard";
import type { InstructorPatientInspectorModel, InspectorListItem } from "@/models/InstructorPatientInspector";
import type { ImagingStudy } from "@/models/ImagingStudy";
import type { Intervention } from "@/models/Intervention";
import type { LabResult } from "@/models/LabResult";
import type { MedicationAdministration } from "@/models/Medication";
import type { Note } from "@/models/Note";
import type { Order } from "@/models/Order";
import type { Patient } from "@/models/Patient";
import type { PatientAssignment } from "@/models/PatientAssignment";
import type { TimelineEvent } from "@/models/TimelineEvent";
import type { CanonicalPatientRuntimeSnapshot, RuntimeProcessProjection } from "@/services/RuntimeSnapshotService";

export type InspectorActiveEffectProjection = {
  readonly id: string;
  readonly name: string;
  readonly source: string;
};

export type InstructorPatientInspectorInput = {
  readonly patient: Patient;
  readonly assignment?: PatientAssignment;
  readonly runtime?: CanonicalPatientRuntimeSnapshot;
  readonly activeEffects: readonly InspectorActiveEffectProjection[];
  readonly timeline: readonly TimelineEvent[];
  readonly interventions: readonly Intervention[];
  readonly medications: readonly MedicationAdministration[];
  readonly labs: readonly LabResult[];
  readonly imaging: readonly ImagingStudy[];
  readonly orders: readonly Order[];
  readonly notes: readonly Note[];
};

function status(patient: Patient, runtime?: CanonicalPatientRuntimeSnapshot): InstructorPatientStatus {
  if (patient.status === "Completed" || runtime?.state.globalStatus === "Resolved") return "Completed";
  if (runtime?.state.globalStatus === "Dead" || runtime?.state.globalStatus === "Arrest") return "Life threatening";
  if (runtime?.state.globalStatus === "Critical") return "Critical";
  return "Stable";
}

function processLabel(process: RuntimeProcessProjection): string {
  return process.moduleId.replace(/_V\d+$/u, "").replaceAll("_", " ");
}

const newestFirst = (a: { timestamp: string }, b: { timestamp: string }) =>
  b.timestamp.localeCompare(a.timestamp);

export function projectInstructorPatientInspector(input: InstructorPatientInspectorInput): InstructorPatientInspectorModel {
  const runtime = input.runtime?.state;
  const vitals = runtime?.vitalSignState;
  const timeline = [...input.timeline].sort(newestFirst).map<InspectorListItem>(event => ({
    id: event.id, title: event.title, detail: event.description, time: event.timestamp, status: event.type,
  }));
  const cardiacProcess = input.runtime?.processes.find(process => process.moduleId === "CARDIAC_ARREST_V1");
  const cardiac = cardiacProcess?.clinicalState;
  return {
    header: {
      patientId: input.patient.id, name: input.patient.name, nationalId: input.patient.isikukood,
      location: input.patient.location, triage: input.patient.triage, status: status(input.patient, input.runtime),
      caseManagerName: input.assignment?.endedAt ? undefined : input.assignment?.caseManagerName,
      simulationTimeSec: runtime?.exerciseTimeSec,
      lastSnapshotTimestamp: runtime?.lastAggregatedAt ?? (runtime ? `T+${runtime.exerciseTimeSec}s` : undefined),
    },
    clinicalState: {
      hasCanonicalRuntime: Boolean(vitals), heartRate: vitals?.readings.heartRate.current,
      respiratoryRate: vitals?.readings.respiratoryRate.current, spo2: vitals?.readings.spo2.current,
      systolicBp: vitals?.readings.systolicBp.current, diastolicBp: vitals?.readings.diastolicBp.current,
      map: vitals?.derived.meanArterialPressure, temperature: vitals?.readings.temperature.current,
      etco2: vitals?.readings.etco2.current, avpu: vitals?.avpu, gcs: vitals?.readings.gcs.current,
    },
    processes: (input.runtime?.processes ?? []).map(process => ({
      id: process.processId, title: processLabel(process), detail: process.processId, status: process.status,
    })),
    effects: [...input.activeEffects].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map(effect => ({ id: effect.id, title: effect.name, detail: effect.source, status: "Active" })),
    timeline,
    ownershipHistory: timeline.filter(event => event.status === "assignment" || event.status === "transfer"),
    interventions: input.interventions.map(item => ({
      id: item.id, title: item.label, detail: `Performed by ${item.performedBy}`, time: item.performedAt, status: item.status,
    })),
    medications: input.medications.map(item => ({
      id: item.id, title: item.name, detail: `${item.dose} · ${item.route} · ${item.administeredBy}`, time: item.administeredAt,
    })),
    labs: input.labs.map(item => ({
      id: item.id, title: `${item.panel} · ${item.name}`, detail: `${item.value} ${item.unit} (${item.referenceRange})`,
      time: item.releasedAt, status: item.status,
    })),
    imaging: input.imaging.map(item => ({
      id: item.id, title: `${item.modality} · ${item.title}`, detail: item.report, time: item.releasedAt, status: item.status,
    })),
    orders: input.orders.map(item => ({
      id: item.id, title: item.title, detail: item.description, time: item.completedAt ?? item.createdAt, status: item.status,
    })),
    notes: input.notes.map(item => ({ id: item.id, title: item.author, detail: item.text, time: item.createdAt })),
    cardiac: cardiac && typeof cardiac.cardiacState === "string" && typeof cardiac.rhythm === "string"
      ? {
        cardiacState: cardiac.cardiacState as NonNullable<InstructorPatientInspectorModel["cardiac"]>["cardiacState"],
        rhythm: cardiac.rhythm as NonNullable<InstructorPatientInspectorModel["cardiac"]>["rhythm"],
        rhythmClassification: cardiac.rhythmClassification as NonNullable<InstructorPatientInspectorModel["cardiac"]>["rhythmClassification"],
        cprActive: cardiac.cprActive === true,
        shockAttemptCount: Number(cardiac.shockAttemptCount ?? 0),
        lastEvent: cardiacProcess.lastEvent?.type,
        lastEventTimeSec: cardiacProcess.lastEvent?.simulationTimeSec,
      } : undefined,
  };
}
