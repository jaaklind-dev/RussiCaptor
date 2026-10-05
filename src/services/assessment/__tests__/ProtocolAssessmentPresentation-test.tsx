import { AssessmentResultDetail } from "@/components/excon/assessment/AssessmentResultDetail";
import { AssessmentResultList } from "@/components/excon/assessment/AssessmentResultList";
import type { ProtocolAssessmentResult } from "@/models/assessment/ProtocolAssessment";
import type { ReactNode } from "react";

function text(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object" && "props" in value) return text((value as { props: { children?: ReactNode } }).props.children);
  return "";
}
const result: ProtocolAssessmentResult = Object.freeze({ assessmentId: "ALS:EXPECT-CPR:PT-001", expectationId: "EXPECT-CPR", protocolId: "ALS_GENERIC_V1", protocolVersion: "1.0.0", subjectId: "PT-001", patientId: "PT-001", status: "MET", evidence: Object.freeze([{ sourceType: "PATIENT_PROCESS" as const, sourceId: "ARREST", patientId: "PT-001", simulationTimeSec: 10 }, { sourceType: "INTERVENTION" as const, sourceId: "CPR", patientId: "PT-001", simulationTimeSec: 12 }]), diagnostics: Object.freeze([]) });

test("WP-38 presentation shows neutral status and evidence without scoring", () => {
  const list = text(AssessmentResultList({ results: [result], onSelect: jest.fn() })).replace(/\s+/gu, " "); const detail = text(AssessmentResultDetail({ result })).replace(/\s+/gu, " ");
  expect(list).toContain("Nõue 1"); expect(list).toContain("Täidetud"); expect(detail).toContain("patsiendi protsess"); expect(detail).toContain("sekkumine");
  expect(`${list} ${detail}`).not.toMatch(/EXPECT-CPR|ARREST|CPR/);
  expect(`${list} ${detail}`).not.toMatch(/score|grade|correct|incorrect|pass|fail/i);
});
