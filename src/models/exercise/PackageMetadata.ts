export type PackageMetadata = Readonly<{
  name: string;
  description: string;
  author: string;
  organization: string;
  createdVersion: string;
  exerciseType: string;
  tags: readonly string[];
}>;
