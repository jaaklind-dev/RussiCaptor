import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import type { ExercisePackageRegistry } from "@/services/exercise/ExercisePackageRegistry";

export type AdminPackageIdentity = Readonly<{
  packageId: string;
  packageVersion: string;
}>;

export type AdminPackageRouteInput = Readonly<{
  packageId?: string | readonly string[];
  packageVersion?: string | readonly string[];
}>;

export type AdminPackageResolution =
  | Readonly<{ ok: true; identity: AdminPackageIdentity; package: ExercisePackage }>
  | Readonly<{ ok: false; code: "INVALID_ROUTE" | "PACKAGE_UNAVAILABLE"; message: string }>;

const scalar = (value?: string | readonly string[]): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

export function adminPackageRouteParams(pkg: Pick<ExercisePackage, "packageId" | "packageVersion">): AdminPackageIdentity {
  return Object.freeze({ packageId: pkg.packageId, packageVersion: pkg.packageVersion });
}

export function adminPackageCreateRoute(identity: AdminPackageIdentity) {
  return Object.freeze({ pathname: "/admin/exercise-create" as const, params: Object.freeze({ ...identity }) });
}

export function resolveAdminPackageSelection(
  input: AdminPackageRouteInput,
  registry: Pick<ExercisePackageRegistry, "get">,
): AdminPackageResolution {
  const packageId = scalar(input.packageId);
  const packageVersion = scalar(input.packageVersion);
  if (!packageId || !packageVersion) {
    return Object.freeze({ ok: false, code: "INVALID_ROUTE", message: "Paketi valik on vigane. Vali pakett uuesti." });
  }
  const pkg = registry.get(packageId, packageVersion);
  if (!pkg) {
    return Object.freeze({ ok: false, code: "PACKAGE_UNAVAILABLE", message: "Valitud õppusepakett pole enam saadaval. Vali pakett uuesti." });
  }
  return Object.freeze({ ok: true, identity: adminPackageRouteParams(pkg), package: pkg });
}
