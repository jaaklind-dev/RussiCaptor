import type {
  InstructorDashboardFilters, InstructorPatientCardModel, InstructorPatientStatus,
} from "@/models/InstructorDashboard";
import type { Patient } from "@/models/Patient";
import type { PatientAssignment } from "@/models/PatientAssignment";
import type { RuntimeState } from "@/models/RuntimeAggregation";
import type { DeepReadonly } from "@/utils/immutable";

export type InstructorPatientMetadata = Pick<Patient, "id" | "name" | "location" | "triage" | "status"> & {
  readonly assignment?: Pick<PatientAssignment, "caseManagerId" | "caseManagerName" | "endedAt">;
};

function projectedStatus(patient: InstructorPatientMetadata, runtime?: DeepReadonly<RuntimeState>): InstructorPatientStatus {
  if (patient.status === "Completed" || runtime?.globalStatus === "Resolved") return "Completed";
  if (runtime?.globalStatus === "Dead" || runtime?.globalStatus === "Arrest") return "Life threatening";
  if (runtime?.globalStatus === "Critical") return "Critical";
  return "Stable";
}

export function comparePatientIds(a: string, b: string): number {
  const aNumber = Number(a.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);
  const bNumber = Number(b.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);
  return aNumber !== bNumber ? aNumber - bNumber : a.localeCompare(b);
}

export function projectInstructorPatients(
  patients: readonly InstructorPatientMetadata[],
  runtimeStates: readonly DeepReadonly<RuntimeState>[]
): InstructorPatientCardModel[] {
  const runtimeByPatient = new Map(runtimeStates.map(state => [state.encounterId, state]));
  return patients.filter(patient => patient.status === "Active" || patient.status === "Completed").map(patient => {
    const runtime = runtimeByPatient.get(patient.id);
    const vitals = runtime?.vitalSignState;
    return {
      patientId: patient.id, name: patient.name, location: patient.location, triage: patient.triage,
      caseManagerId: patient.assignment?.endedAt ? undefined : patient.assignment?.caseManagerId,
      caseManagerName: patient.assignment?.endedAt ? undefined : patient.assignment?.caseManagerName,
      status: projectedStatus(patient, runtime), avpu: vitals?.avpu,
      spo2: vitals?.pulseOx?.signalQuality === "NO_SIGNAL" ? undefined : vitals?.pulseOx?.measuredSpO2 ?? vitals?.readings.spo2.current,
      pulseOxSignalQuality: vitals?.pulseOx?.signalQuality,
      respiratoryRate: vitals?.readings.respiratoryRate.current,
      heartRate: vitals?.readings.heartRate.current, systolicBp: vitals?.readings.systolicBp.current,
      simulationTimeSec: runtime?.exerciseTimeSec,
      lastUpdate: runtime?.lastAggregatedAt ?? (runtime ? `T+${runtime.exerciseTimeSec}s` : undefined),
      hasCanonicalRuntime: Boolean(runtime?.vitalSignState),
      clinicalState: runtime?.physiologicDecompensation?.clinicalState,
    };
  }).sort((a, b) => comparePatientIds(a.patientId, b.patientId));
}

export function filterInstructorPatients(
  patients: readonly InstructorPatientCardModel[], filters: InstructorDashboardFilters
): InstructorPatientCardModel[] {
  return patients.filter(patient =>
    (filters.location === "All" || patient.location === filters.location) &&
    (filters.triage === "All" || patient.triage === filters.triage) &&
    (filters.caseManager === "All" || patient.caseManagerName === filters.caseManager) &&
    (filters.status === "All" || patient.status === filters.status)
  );
}
