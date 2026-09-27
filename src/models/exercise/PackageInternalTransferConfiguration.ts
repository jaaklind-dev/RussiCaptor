export type PackageInternalTransferDefinition = Readonly<{
  actionId: string;
  patientId: string;
  fromLocationId: string;
  toLocationId: string;
  displayName: string;
}>;

export type PackageInternalTransferConfiguration = Readonly<{
  schemaVersion: 1;
  definitions: readonly PackageInternalTransferDefinition[];
}>;
