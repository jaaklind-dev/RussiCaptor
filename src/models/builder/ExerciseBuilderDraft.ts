import type { ImagingModality } from "@/models/ImagingStudy";
import type { PatientStatus, TriageCategory } from "@/models/Patient";
import type { LabResultGroupType } from "@/models/LaboratoryWorkflow";

export type BuilderPatient = Readonly<{
  id: string;
  name: string;
  triage: TriageCategory;
  status?: Extract<PatientStatus, "Active" | "Incoming">;
  location: string;
  handover: string;
  ageYears?: number;
  sex?: "F" | "M" | "OTHER" | "UNKNOWN";
  vitals: Readonly<Partial<Record<"hr" | "sbp" | "dbp" | "rr" | "spo2" | "temperature" | "gcs" | "etco2" | "crt", number>>>;
  labs: Readonly<Record<string, number | string>>;
}>;

export type BuilderImage = Readonly<{
  localUri: string;
  fileName: string;
  source: string;
  licenseId: string;
  contributor: string;
  attribution?: string;
}>;

export type BuilderStudy = Readonly<{
  id: string;
  patientId: string;
  modality: ImagingModality;
  title: string;
  report: string;
  resultDelaySeconds: number;
  image?: BuilderImage;
}>;

/** Mutable authoring source. It is never itself an installed runtime package. */
export type ExerciseBuilderDraft = Readonly<{
  schemaVersion: 1;
  packageId: string;
  packageVersion: string;
  name: string;
  description: string;
  author: string;
  language: string;
  sourceReference?: string;
  patients: readonly BuilderPatient[];
  studies: readonly BuilderStudy[];
  labResultDelaySeconds: Partial<Readonly<Record<LabResultGroupType, number>>>;
}>;

export type BuilderSourceBundle = Readonly<{
  schemaVersion: 1;
  draft: ExerciseBuilderDraft;
  /** Local bytes, not a Drive URL; only the desktop compiler reads this field. */
  images: readonly Readonly<{ studyId: string; fileName: string; base64: string }>[];
}>;
