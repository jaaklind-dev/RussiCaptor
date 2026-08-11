import { AssessmentMetricsSummary } from "@/components/excon/assessment/AssessmentMetricsSummary";
import type { MetricResult } from "@/models/analytics/Analytics";
import type { ReactNode } from "react";

const value = (metricId: string, amount: number, subjectId?: string): MetricResult => Object.freeze({ metricId, metricVersion: "1.0.0", providerId: "assessment.protocol", scope: subjectId ? "PATIENT" : "EXERCISE", ...(subjectId ? { subjectId } : {}), category: "ASSESSMENT", status: "VALUE", value: amount, unit: metricId.endsWith("ratio") ? "RATIO" : "COUNT", evidence: Object.freeze([{ sourceType: "ASSESSMENT_RESULT", sourceId: "A-1", ...(subjectId ? { patientId: subjectId } : {}) }]) }) as MetricResult;
function text(node: ReactNode): string { if (typeof node === "string" || typeof node === "number") return String(node); if (Array.isArray(node)) return node.map(text).join(" "); if (node && typeof node === "object" && "props" in node) return text((node as { props: { children?: ReactNode } }).props.children); return ""; }
const exercise = [value("assessment.expectations.total", 12), value("assessment.expectations.applicable", 10), value("assessment.expectations.assessable", 8), value("assessment.expectations.met", 6), value("assessment.expectations.not_met", 2), value("assessment.expectations.unavailable", 2), value("assessment.expectations.not_applicable", 2), value("assessment.completion_ratio", 0.8), value("assessment.satisfaction_ratio", 0.75)];
const patient = [value("patient.assessment.total", 3, "P001"), value("patient.assessment.applicable", 3, "P001"), value("patient.assessment.assessable", 2, "P001"), value("patient.assessment.met", 1, "P001"), value("patient.assessment.not_met", 1, "P001"), value("patient.assessment.unavailable", 1, "P001"), value("patient.assessment.not_applicable", 0, "P001"), value("patient.assessment.completion_ratio", 2 / 3, "P001"), value("patient.assessment.satisfaction_ratio", 0.5, "P001")];

test("assessment summary presents neutral exercise and patient metrics without scoring language", () => {
  const exerciseText = text(AssessmentMetricsSummary({ metrics: exercise })).replace(/\s+/gu, " ");
  const patientText = text(AssessmentMetricsSummary({ metrics: patient, patientId: "P001" })).replace(/\s+/gu, " ");
  expect(exerciseText).toContain("Assessable 8 / 10 applicable"); expect(exerciseText).toContain("Expectation satisfaction 75%");
  expect(patientText).toContain("Assessment Metrics · P001"); expect(patientText).toContain("Expectation satisfaction 50%");
  expect(`${exerciseText} ${patientText}`).not.toMatch(/Score:|Grade:|Performance:|pass|fail/i);
});
