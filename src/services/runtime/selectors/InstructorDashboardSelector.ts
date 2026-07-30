import type {
  InstructorDashboardFilters, InstructorPatientCardModel, InstructorPatientStatus,
} from "@/models/InstructorDashboard";
import type { Patient } from "@/models/Patient";
import type { PatientAssignment } from "@/models/PatientAssignment";
import type { RuntimeState } from "@/models/RuntimeAggregation";

export type InstructorPatientMetadata = Pick<Patient, "id" | "name" | "location" | "triage" | "status"> & {
  readonly assignment?: Pick<PatientAssignment, "caseManagerId" | "caseManagerName" | "endedAt">;
};

function projectedStatus(patient: InstructorPatientMetadata, runtime?: RuntimeState): InstructorPatientStatus {
  if (patient.status === "Completed" || runtime?.globalStatus === "Resolved") return "Completed";
  if (runtime?.globalStatus === "Dead" || runtime?.globalStatus === "Arrest") return "Life threatening";
  if (runtime?.globalStatus === "Critical") return "Critical";
  return "Stable";
}

const severityOrder: Record<InstructorPatientStatus, number> = {
  "Life threatening": 0, Critical: 1, "Requires attention": 2, Stable: 3, Completed: 4,
};
const triageOrder: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3, Expectant: 4 };

export function projectInstructorPatients(
  patients: readonly InstructorPatientMetadata[],
  runtimeStates: readonly RuntimeState[]
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
      spo2: vitals?.readings.spo2.current, respiratoryRate: vitals?.readings.respiratoryRate.current,
      heartRate: vitals?.readings.heartRate.current, systolicBp: vitals?.readings.systolicBp.current,
      simulationTimeSec: runtime?.exerciseTimeSec,
      lastUpdate: runtime?.lastAggregatedAt ?? (runtime ? `T+${runtime.exerciseTimeSec}s` : undefined),
      hasCanonicalRuntime: Boolean(runtime?.vitalSignState),
    };
  }).sort((a, b) => severityOrder[a.status] - severityOrder[b.status] ||
    (triageOrder[a.triage] ?? 99) - (triageOrder[b.triage] ?? 99) || a.patientId.localeCompare(b.patientId));
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
