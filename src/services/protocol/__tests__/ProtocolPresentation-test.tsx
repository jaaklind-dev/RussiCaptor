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

  test("Catalog detail displays exact protocol, hash and requirements", () => {
    const output = text(PackageDetail({ entry: { exercisePackage: pkg, compatibility: "SUPPORTED" }, active: false, onActivate: jest.fn() }));
    expect(output).toMatch(/ALS_GENERIC_V1\s*@\s*1\.0\.0/); expect(output).toContain(provenance.protocolHash);
    expect(output).toContain("CARDIAC_ARREST");
  });

  test("ExCon information displays active protocol provenance", () => {
    const definition = text(ExerciseInformationCard({ definition: pkg.definition }));
    const packageInfo = text(ExercisePackageInformationCard({ exercisePackage: pkg, compatibility: "SUPPORTED" }));
    expect(definition).toMatch(/ALS_GENERIC_V1\s*@\s*1\.0\.0/); expect(packageInfo).toContain(provenance.protocolHash);
  });

  test("Debrief displays factual protocol provenance without scoring", () => {
    const output = text(DebriefSummary({ report }));
    expect(output).toMatch(/ALS_GENERIC_V1\s*@\s*1\.0\.0/); expect(output).toContain(provenance.protocolHash);
    expect(output).not.toMatch(/score|correct|incorrect/i);
  });
});
