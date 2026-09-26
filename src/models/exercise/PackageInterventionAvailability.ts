export type PackagePatientInterventionAvailability = Readonly<{
  patientId: string;
  /** Patient-only additions to the package-wide resource intervention allowlist. */
  allowedResourceInterventionDefinitionIds: readonly string[];
  /** Specialized process/action families exposed by existing dedicated runtimes. */
  allowedSpecializedActions?: readonly string[];
}>;

export type PackageInterventionAvailability = Readonly<{
  schemaVersion: 1;
  /** Generic procedures intentionally shared by every listed package patient. */
  packageWideResourceInterventionDefinitionIds: readonly string[];
  /** Package-wide dedicated action families such as MTP and transport. */
  packageWideSpecializedActions?: readonly string[];
  patients: readonly PackagePatientInterventionAvailability[];
}>;
