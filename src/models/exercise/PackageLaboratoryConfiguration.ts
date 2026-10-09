import type { LabResultGroupType, NarvaLabPackageId } from "@/models/LaboratoryWorkflow";

/** Optional package-owned inputs for the existing laboratory workflow. */
export type PackageLaboratoryConfiguration = Readonly<{
  schemaVersion: 1;
  catalogPackageId: NarvaLabPackageId;
  resultDelaySeconds?: Partial<Readonly<Record<LabResultGroupType, number>>>;
  patients: readonly Readonly<{
    patientId: string;
    /** Static/scenario values only. Dynamic physiology remains runtime-owned. */
    initialResults: Readonly<Record<string, number | string>>;
  }>[];
}>;
