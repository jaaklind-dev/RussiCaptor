import type { ExerciseEvaluationProfile } from "@/models/evaluation/ExerciseEvaluation";
import type { ClinicalProtocolConfiguration } from "@/models/protocol/ClinicalProtocolConfiguration";
import { calculateEvaluationProfileHash } from "./ExerciseEvaluationProfileHash";

export type EvaluationProfileValidationCode = "INVALID_PROFILE_ID" | "INVALID_PROFILE_VERSION" | "INVALID_PROFILE_HASH" | "DUPLICATE_DIMENSION" | "DUPLICATE_EXPECTATION_REFERENCE" | "MISSING_EXPECTATION_REFERENCE" | "WRONG_PROTOCOL" | "INVALID_DIMENSION";
export type EvaluationProfileDiagnostic = Readonly<{ code: EvaluationProfileValidationCode; path: string; message: string }>;
export class ExerciseEvaluationProfileValidator {
  validate(profile: ExerciseEvaluationProfile, protocol?: ClinicalProtocolConfiguration): readonly EvaluationProfileDiagnostic[] {
    const issues: EvaluationProfileDiagnostic[] = []; const add = (code: EvaluationProfileValidationCode, path: string, message: string) => issues.push(Object.freeze({ code, path, message }));
    if (!profile.profileId?.trim()) add("INVALID_PROFILE_ID", "profileId", "Profile ID is required");
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(profile.version)) add("INVALID_PROFILE_VERSION", "version", "Profile version must use semantic versioning");
    const { evaluationProfileHash: _hash, ...content } = profile;
    if (calculateEvaluationProfileHash(content) !== profile.evaluationProfileHash) add("INVALID_PROFILE_HASH", "evaluationProfileHash", "Profile hash mismatch");
    const dimensionIds = profile.dimensions.map(item => item.dimensionId);
    for (const duplicate of [...new Set(dimensionIds.filter((id, index) => dimensionIds.indexOf(id) !== index))].sort()) add("DUPLICATE_DIMENSION", "dimensions", `Duplicate dimension ${duplicate}`);
    const refs = profile.dimensions.flatMap(item => item.assessmentExpectations.map(ref => ref.expectationId));
    for (const duplicate of [...new Set(refs.filter((id, index) => refs.indexOf(id) !== index))].sort()) add("DUPLICATE_EXPECTATION_REFERENCE", "dimensions.assessmentExpectations", `Duplicate expectation reference ${duplicate}`);
    profile.dimensions.forEach((dimension, index) => { if (!dimension.dimensionId?.trim() || !dimension.title?.trim() || !Number.isInteger(dimension.displayOrder) || dimension.displayOrder < 0 || !dimension.assessmentExpectations.length || dimension.assessmentExpectations.some(item => !["CRITICAL", "CORE", "INFORMATIVE"].includes(item.classification))) add("INVALID_DIMENSION", `dimensions[${index}]`, "Dimension requires ID, title, non-negative display order, expectations and valid classifications"); });
    if (protocol) {
      if (profile.protocolRequirement.protocolId !== protocol.protocolId || profile.protocolRequirement.version !== protocol.version) add("WRONG_PROTOCOL", "protocolRequirement", "Profile requires a different exact protocol version");
      const known = new Set(protocol.assessmentExpectations.map(item => item.expectationId));
      for (const ref of [...new Set(refs)].sort()) if (!known.has(ref)) add("MISSING_EXPECTATION_REFERENCE", "dimensions.assessmentExpectations", `Unknown protocol expectation ${ref}`);
    }
    return Object.freeze(issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code)));
  }
  assertValid(profile: ExerciseEvaluationProfile, protocol?: ClinicalProtocolConfiguration) { const issues = this.validate(profile, protocol); if (issues.length) throw new Error(`INVALID_EVALUATION_PROFILE:${issues.map(item => `${item.code}@${item.path}`).join(",")}`); }
}
