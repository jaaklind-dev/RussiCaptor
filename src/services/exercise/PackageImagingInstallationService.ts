import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import type { MaterializedPatientDataset } from "@/models/exercise/PackagePatientDataset";
import type { ImagingStudy } from "@/models/ImagingStudy";
import type { Order } from "@/models/Order";
import { clinicalDataProvider } from "@/providers/ProviderFactory";
import { PatientDatasetError } from "./PackagePatientMaterializationService";

/**
 * Adapts versioned package Imaging content into the existing workflow stores.
 * Legacy/demo Imaging remains available outside canonical package preparation,
 * but canonical exercises receive only content owned by their package.
 */
export function installPackageImagingDefinitions(
  plan: MaterializedPatientDataset,
  pkg: ExercisePackage,
): void {
  const definitions = pkg.imagingConfiguration?.definitions ?? [];
  const patientIds = new Set(plan.patients.map(record => record.patient.id));
  const invalid = definitions.find(item => !patientIds.has(item.study.patientId));
  if (invalid) throw new PatientDatasetError(
    "MALFORMED_PATIENT",
    `Imaging study ${invalid.study.id} references patient ${invalid.study.patientId} outside ${plan.datasetId}.`,
  );

  const studies = clinicalDataProvider.getImagingStudies();
  const existingStudies = new Map(
    studies
      .filter(study => study.exerciseId === plan.exerciseId)
      .map(study => [study.id, study] as const),
  );
  const installedStudies: ImagingStudy[] = definitions.map(definition => {
    const existing = existingStudies.get(definition.study.id);
    return {
      ...structuredClone(definition.study),
      exerciseId: plan.exerciseId,
      ...(existing ? {
        status: existing.status,
        imageVisibility: existing.imageVisibility,
        reportVisibility: existing.reportVisibility,
        ...(existing.releasedAt ? { releasedAt: existing.releasedAt } : {}),
      } : {}),
    };
  });
  studies.splice(0, studies.length, ...installedStudies);

  const orders = clinicalDataProvider.getOrders();
  const existingOrders = new Map(
    orders
      .filter(order => order.category === "imaging" && order.exerciseId === plan.exerciseId)
      .map(order => [order.id, order] as const),
  );
  const nonImagingOrders = orders.filter(order => order.category !== "imaging");
  const installedOrders: Order[] = definitions.map(definition => {
    const existing = existingOrders.get(definition.order.id);
    return {
      ...structuredClone(definition.order),
      exerciseId: plan.exerciseId,
      patientId: definition.study.patientId,
      category: "imaging",
      ...(existing ? {
        status: existing.status,
        visibility: existing.visibility,
        ...(existing.createdAt ? { createdAt: existing.createdAt } : {}),
        ...(existing.completedAt ? { completedAt: existing.completedAt } : {}),
      } : {}),
    };
  });
  orders.splice(0, orders.length, ...nonImagingOrders, ...installedOrders);
}
