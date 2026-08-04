export type ExercisePackageManifest = Readonly<{
  packageId: string;
  packageVersion: string;
  definitionHash: string;
  packageHash: string;
  compatibilityVersion: number;
}>;

export type ExercisePackageCompatibility = "SUPPORTED" | "LEGACY" | "INCOMPATIBLE";
