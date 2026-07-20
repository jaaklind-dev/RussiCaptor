export type PatientAssignment = {
  patientId: string;
  caseManagerId: string;
  caseManagerName: string;
  assignedAt: string;
  endedAt?: string;
};
