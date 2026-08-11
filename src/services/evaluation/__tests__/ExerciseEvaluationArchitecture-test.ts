/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";

function sourceFiles(directory: string): string[] { return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => { const target = path.join(directory, entry.name); return entry.isDirectory() ? sourceFiles(target) : /\.(ts|tsx)$/u.test(entry.name) ? [target] : []; }); }

test("WP-40 remains downstream and canonical Runtime has no Evaluation dependency", () => {
  const runtimeRoot = path.join(process.cwd(), "src", "services", "runtime");
  const runtimeSource = sourceFiles(runtimeRoot).filter(file => !file.includes(`${path.sep}__tests__${path.sep}`)).map(file => fs.readFileSync(file, "utf8")).join("\n");
  expect(runtimeSource).not.toMatch(/ExerciseEvaluation|EvaluationProfile|services\/evaluation/u);
});
