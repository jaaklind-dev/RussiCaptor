import type { ProtocolAssessmentReport } from "@/models/assessment/ProtocolAssessment"; import { sha256Text } from "@/utils/sha256"; import { stableJson } from "@/utils/stableJson";
export const calculateAssessmentHash = (report: Omit<ProtocolAssessmentReport, "assessmentHash">): string => sha256Text(stableJson(report));
