import { DebriefSummary } from "@/components/excon/debrief/DebriefSummary";
import { ExerciseInformationCard } from "@/components/excon/ExerciseInformationCard";
import { ExercisePackageInformationCard } from "@/components/excon/ExercisePackageInformationCard";
import { PackageDetail } from "@/components/excon/catalog/PackageDetail";
import { ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { exercisePackageLoader } from "@/services/exercise/ExercisePackageService";
import { reconstructDebrief } from "@/services/debrief/DebriefEngine";
import type { ReactNode } from "react";

function text(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object" && "props" in value) {
    const element = value as { type?: unknown; props: { children?: ReactNode } };
    if (typeof element.type === "function" && ["Hash", "List", "Row"].includes(element.type.name)) return text(element.type(element.props));
    return text(element.props.children);
  }
  return "";
}

describe("WP-37 read-only protocol presentation", () => {
  const pkg = exercisePackageLoader.load(ALS_PROTOCOL_REFERENCE_EXERCISE_PACKAGE);
  const provenance = pkg.definition.protocolProvenance!;
  const report = reconstructDebrief({ exercise: { exerciseId: "WP37", lifecycleState: "COMPLETED", simulationTimeSec: 1, speed: 1, version: 1 }, patients: [], timeline: [], protocolProvenance: provenance });

  test("Catalog detail displays readable protocol identity and requirements without hashes", () => {
    const output = text(PackageDetail({ entry: { exercisePackage: pkg, compatibility: "SUPPORTED" }, active: false, onActivate: jest.fn() }));
    expect(output).toContain(provenance.name); expect(output).toContain(`versioon ${provenance.version}`);
    expect(output).not.toContain(provenance.protocolHash);
    expect(output).toContain("CARDIAC_ARREST");
  });

  test("ExCon operational information hides development-only protocol identifiers and hashes", () => {
    const definition = text(ExerciseInformationCard({ definition: pkg.definition }));
    const packageInfo = text(ExercisePackageInformationCard({ exercisePackage: pkg, compatibility: "SUPPORTED" }));
    expect(`${definition} ${packageInfo}`).not.toContain(provenance.protocolHash);
    expect(packageInfo).toContain("Versioon");
  });

  test("Debrief displays human-readable protocol provenance without hashes or scoring", () => {
    const output = text(DebriefSummary({ report }));
    expect(output).toContain(provenance.name); expect(output).not.toContain(provenance.protocolHash);
    expect(output).not.toMatch(/score|correct|incorrect/i);
  });
});
