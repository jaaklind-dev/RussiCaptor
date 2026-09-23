import type { ImagingStudy } from "@/models/ImagingStudy";
import type { Order } from "@/models/Order";

export type PackageImagingStudyDefinition = Readonly<
  Omit<ImagingStudy, "exerciseId" | "releasedAt">
>;

export type PackageImagingOrderDefinition = Readonly<
  Omit<Order, "exerciseId" | "patientId" | "category" | "createdAt" | "completedAt">
>;

/** Versioned package content installed into the existing Imaging/order workflow. */
export type PackageImagingConfiguration = Readonly<{
  schemaVersion: 1;
  definitions: readonly Readonly<{
    study: PackageImagingStudyDefinition;
    order: PackageImagingOrderDefinition;
  }>[];
}>;
