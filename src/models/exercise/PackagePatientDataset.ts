import type { GoldenFixture } from "@/models/GoldenTest";
import type { Patient } from "@/models/Patient";

export type PackagePatientRecord = Readonly<{
  patient: Readonly<Patient>;
  initialLocationId?: string;
  runtimeFixture?: Readonly<GoldenFixture>;
}>;

export type PackagePatientDataset = Readonly<{
  datasetId: string;
  version: string;
  patients: readonly PackagePatientRecord[];
}>;

export type MaterializedPatientDataset = Readonly<{
  exerciseId: string;
  packageId: string;
  packageVersion: string;
  packageHash: string;
  datasetId: string;
  datasetVersion: string;
  materializationHash: string;
  patients: readonly PackagePatientRecord[];
}>;
