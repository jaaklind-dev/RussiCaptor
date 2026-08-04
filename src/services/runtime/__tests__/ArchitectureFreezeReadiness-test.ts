/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : /\.(ts|tsx)$/u.test(entry.name) ? [target] : [];
  });
}

function dependencyCycles(): string[][] {
  const root = path.join(process.cwd(), "src"); const files = sourceFiles(root);
  const moduleId = (file: string) => file.replace(root + path.sep, "").replaceAll(path.sep, "/").replace(/\.(ts|tsx)$/u, "");
  const modules = new Set(files.map(moduleId)); const graph = new Map<string, string[]>();
  for (const file of files) {
    const dependencies = [...fs.readFileSync(file, "utf8").matchAll(/(?:from|import)\s+"@\/([^"]+)"/gu)].map(match => match[1]).flatMap(candidate => modules.has(candidate) ? [candidate] : modules.has(`${candidate}/index`) ? [`${candidate}/index`] : []);
    graph.set(moduleId(file), dependencies);
  }
  const visited = new Set<string>(); const active = new Set<string>(); const stack: string[] = []; const cycles: string[][] = [];
  const visit = (module: string) => { visited.add(module); active.add(module); stack.push(module); for (const dependency of graph.get(module) ?? []) { if (!visited.has(dependency)) visit(dependency); else if (active.has(dependency)) cycles.push([...stack.slice(stack.indexOf(dependency)), dependency]); } stack.pop(); active.delete(module); };
  for (const module of graph.keys()) if (!visited.has(module)) visit(module);
  return cycles;
}

describe("WP-29A Architecture Freeze Readiness", () => {
  test("source dependency graph has no import cycles", () => {
    expect(dependencyCycles()).toEqual([]);
  });

  test("canonical Exercise Snapshot is a deeply immutable published value", () => {
    const snapshot = getCanonicalExerciseSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    (snapshot as { lifecycleState: string }).lifecycleState = "COMPLETED";
    expect(snapshot.lifecycleState).not.toBe("COMPLETED");
    expect(getCanonicalExerciseSnapshot().lifecycleState).not.toBe("COMPLETED");
  });
});
