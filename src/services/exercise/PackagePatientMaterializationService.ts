import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import type { MaterializedPatientDataset, PackagePatientDataset, PackagePatientRecord } from "@/models/exercise/PackagePatientDataset";
import type { Patient } from "@/models/Patient";
import { dataProvider } from "@/providers/ProviderFactory";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";
import { deepFreeze } from "@/utils/immutable";

export type PatientDatasetFailureCode = "UNKNOWN_PATIENT_DATASET" | "UNSUPPORTED_PATIENT_DATASET_VERSION" | "EMPTY_PATIENT_DATASET" | "DUPLICATE_PATIENT_ID" | "MALFORMED_PATIENT" | "INVALID_RUNTIME_FIXTURE";
export class PatientDatasetError extends Error { constructor(readonly code: PatientDatasetFailureCode, message: string) { super(message); } }

const splitIdentity = (identity: string): { datasetId: string; version: string } => {
  const match = /^(.*)\.v([^.]+)$/.exec(identity);
  if (!match) throw new PatientDatasetError("UNSUPPORTED_PATIENT_DATASET_VERSION", `Patient dataset identity ${identity} has no explicit version.`);
  return { datasetId: match[1], version: match[2] };
};
const clonePatient = (patient: Readonly<Patient>): Patient => ({ ...patient, mist: { ...patient.mist } });
const validPatient = (value: Readonly<Patient>): boolean => Boolean(value.id?.trim() && value.isikukood?.trim() && value.name?.trim() && ["P1", "P2", "P3", "P4"].includes(value.triage) && ["Active", "Incoming", "Transferred", "Completed"].includes(value.status) && value.location?.trim() && value.mist && typeof value.mist.mechanism === "string" && typeof value.mist.injuries === "string" && typeof value.mist.signs === "string" && typeof value.mist.treatment === "string");

export class PackagePatientDatasetRegistry {
  private readonly values = new Map<string, PackagePatientDataset>();
  register(dataset: PackagePatientDataset): void {
    const identity = splitIdentity(dataset.datasetId); if (identity.version !== dataset.version) throw new PatientDatasetError("UNSUPPORTED_PATIENT_DATASET_VERSION", `Dataset ${dataset.datasetId} version mismatch.`);
    if (this.values.has(dataset.datasetId)) throw new PatientDatasetError("UNSUPPORTED_PATIENT_DATASET_VERSION", `Dataset ${dataset.datasetId} is already registered.`);
    this.values.set(dataset.datasetId, deepFreeze(structuredClone(dataset)) as PackagePatientDataset);
  }
  resolve(datasetId: string): PackagePatientDataset {
    const value = this.values.get(datasetId); if (!value) throw new PatientDatasetError("UNKNOWN_PATIENT_DATASET", `Patient dataset ${datasetId} is not registered.`);
    return deepFreeze(structuredClone(value)) as PackagePatientDataset;
  }
}

export function createPatientMaterializationPlan(exerciseId: string, pkg: ExercisePackage, registry: PackagePatientDatasetRegistry): MaterializedPatientDataset {
  const dataset = registry.resolve(pkg.patientDatasetId);
  if (!dataset.patients.length) throw new PatientDatasetError("EMPTY_PATIENT_DATASET", `Patient dataset ${dataset.datasetId} is empty.`);
  const ordered = [...dataset.patients].sort((a, b) => a.patient.id.localeCompare(b.patient.id));
  const ids = new Set<string>();
  for (const record of ordered) {
    if (!validPatient(record.patient)) throw new PatientDatasetError("MALFORMED_PATIENT", `Patient ${record.patient?.id ?? "UNKNOWN"} is malformed.`);
    if (ids.has(record.patient.id)) throw new PatientDatasetError("DUPLICATE_PATIENT_ID", `Patient ${record.patient.id} is duplicated.`); ids.add(record.patient.id);
    if (record.runtimeFixture && record.runtimeFixture.patientId !== record.patient.id) throw new PatientDatasetError("INVALID_RUNTIME_FIXTURE", `Runtime fixture patient identity differs for ${record.patient.id}.`);
  }
  const patients = deepFreeze(ordered.map(record => ({ patient: clonePatient(record.patient), ...(record.runtimeFixture ? { runtimeFixture: structuredClone(record.runtimeFixture) } : {}) }))) as readonly PackagePatientRecord[];
  const canonical = { exerciseId, packageId: pkg.packageId, packageVersion: pkg.packageVersion, packageHash: pkg.packageHash, datasetId: dataset.datasetId, datasetVersion: dataset.version, patients };
  return deepFreeze({ ...canonical, materializationHash: sha256Text(stableJson(canonical)) }) as MaterializedPatientDataset;
}

let activeMaterialization: MaterializedPatientDataset | undefined;
export function installPatientMaterialization(plan: MaterializedPatientDataset): void { dataProvider.installPatients(plan.patients.map(record => clonePatient(record.patient))); activeMaterialization = deepFreeze(structuredClone(plan)) as MaterializedPatientDataset; }
export function getPatientMaterialization(exerciseId: string): MaterializedPatientDataset | undefined { return activeMaterialization?.exerciseId === exerciseId ? deepFreeze(structuredClone(activeMaterialization)) as MaterializedPatientDataset : undefined; }
export function restorePatientMaterialization(value?: MaterializedPatientDataset): void { activeMaterialization = value ? deepFreeze(structuredClone(value)) as MaterializedPatientDataset : undefined; }
