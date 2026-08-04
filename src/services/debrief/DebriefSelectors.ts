import type { DebriefFilters, DebriefReport, PatientDebriefSummary } from "./DebriefModel";

export function filterDebriefPatients(report: DebriefReport, filters: DebriefFilters): readonly PatientDebriefSummary[] {
  if (filters.exercisePhase && filters.exercisePhase !== report.exerciseState) return Object.freeze([]);
  const query = filters.search?.trim().toLocaleLowerCase();
  return Object.freeze(report.patients.filter(patient =>
    (!filters.patientId || patient.patientId === filters.patientId) &&
    (!filters.caseManager || patient.assignedCaseManagers.includes(filters.caseManager)) &&
    (!filters.outcome || patient.outcome === filters.outcome) &&
    (!filters.category || report.timeline.some(event => event.patientId === patient.patientId && event.category === filters.category)) &&
    (!query || `${patient.patientId} ${patient.name} ${patient.initialLocation} ${patient.finalLocation} ${patient.outcome}`.toLocaleLowerCase().includes(query))
  ));
}

