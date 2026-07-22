export type VitalSource = "scenario" | "manual";

export type VitalSigns = {
  id: string;
  exerciseId: string;
  patientId: string;
  exerciseMinute: number;
  recordedAt?: string;
  recordedBy?: string;
  source: VitalSource;
  heartRate?: number;
  systolicBloodPressure?: number;
  diastolicBloodPressure?: number;
  respiratoryRate?: number;
  oxygenSaturation?: number;
  temperature?: number;
  gcs?: number;
  bloodGlucose?: number;
  etco2?: number;
  painScore?: number;
};
