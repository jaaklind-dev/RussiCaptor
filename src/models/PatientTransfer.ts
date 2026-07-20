export type PatientTransfer = {
  id: string;
  patientId: string;
  fromCaseManagerId: string;
  fromCaseManagerName: string;
  toCaseManagerId: string;
  toCaseManagerName: string;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  requestedAt: string;
  acceptedAt?: string;
  cancelledAt?: string;
  rejectedAt?: string;
};
