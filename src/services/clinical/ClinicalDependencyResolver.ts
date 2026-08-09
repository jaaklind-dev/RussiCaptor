import type { ClinicalModule } from "@/models/clinical/ClinicalModule";
import type { ClinicalModuleDependency } from "@/models/clinical/ClinicalModuleDependency";
import { diagnostic, sortCompositionDiagnostics, type ModuleCompositionDiagnostic } from "./ClinicalCompositionDiagnostics";
import type { ClinicalModuleRegistry } from "./ClinicalModuleRegistry";

const identity = (dependency: ClinicalModuleDependency): string => `${dependency.moduleId}@${dependency.version}`;
const compare = (left: ClinicalModuleDependency, right: ClinicalModuleDependency): number => left.moduleId.localeCompare(right.moduleId) || left.version.localeCompare(right.version);
const exactVersion = /^\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$/;

export type ClinicalDependencyResolution = Readonly<{
  modules: readonly ClinicalModule[];
  diagnostics: readonly ModuleCompositionDiagnostic[];
}>;

export class ClinicalDependencyResolver {
  constructor(private readonly registry: ClinicalModuleRegistry) {}

  resolve(required: readonly ClinicalModuleDependency[]): ClinicalDependencyResolution {
    const diagnostics: ModuleCompositionDiagnostic[] = [];
    const requested = new Map<string, string>();
    const resolved = new Map<string, ClinicalModule>();
    const pending = [...required].sort(compare);

    while (pending.length) {
      const dependency = pending.shift()!;
      if (!dependency.moduleId?.trim() || !exactVersion.test(dependency.version)) {
        diagnostics.push(diagnostic("ERROR", "INVALID_DEPENDENCY_VERSION", `Dependency ${identity(dependency)} must use an explicit version`, dependency.moduleId));
        continue;
      }
      const priorVersion = requested.get(dependency.moduleId);
      if (priorVersion) {
        if (priorVersion !== dependency.version) diagnostics.push(diagnostic("ERROR", "VERSION_MISMATCH", `Module ${dependency.moduleId} requires both ${priorVersion} and ${dependency.version}`, dependency.moduleId));
        else if (required.filter(item => item.moduleId === dependency.moduleId && item.version === dependency.version).length > 1) diagnostics.push(diagnostic("ERROR", "DUPLICATE_MODULE_ID", `Module ${identity(dependency)} is declared more than once`, dependency.moduleId));
        continue;
      }
      requested.set(dependency.moduleId, dependency.version);
      const module = this.registry.get(dependency.moduleId, dependency.version);
      if (!module) {
        const available = this.registry.versions(dependency.moduleId);
        diagnostics.push(diagnostic("ERROR", available.length ? "VERSION_MISMATCH" : "MISSING_DEPENDENCY", available.length
          ? `Module ${dependency.moduleId} version ${dependency.version} is unavailable; registered: ${available.join(", ")}`
          : `Module ${identity(dependency)} is not registered`, dependency.moduleId));
        continue;
      }
      resolved.set(identity(dependency), module);
      pending.push(...module.manifest.dependencies);
      pending.sort(compare);
    }

    if (diagnostics.some(item => item.severity === "ERROR")) return Object.freeze({ modules: Object.freeze([]), diagnostics: sortCompositionDiagnostics(diagnostics) });

    const indegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();
    for (const [key, module] of resolved) {
      indegree.set(key, module.manifest.dependencies.length);
      for (const dependency of module.manifest.dependencies) {
        const dependencyKey = identity(dependency);
        const values = dependents.get(dependencyKey) ?? [];
        values.push(key); dependents.set(dependencyKey, values);
      }
    }
    const ready = [...resolved.keys()].filter(key => indegree.get(key) === 0).sort();
    const ordered: ClinicalModule[] = [];
    while (ready.length) {
      const key = ready.shift()!;
      ordered.push(resolved.get(key)!);
      for (const dependent of [...(dependents.get(key) ?? [])].sort()) {
        const next = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, next);
        if (next === 0) { ready.push(dependent); ready.sort(); }
      }
    }
    if (ordered.length !== resolved.size) diagnostics.push(diagnostic("ERROR", "CYCLIC_DEPENDENCY", "Clinical Module dependency graph contains a cycle"));
    return Object.freeze({ modules: Object.freeze(diagnostics.length ? [] : ordered), diagnostics: sortCompositionDiagnostics(diagnostics) });
  }
}
