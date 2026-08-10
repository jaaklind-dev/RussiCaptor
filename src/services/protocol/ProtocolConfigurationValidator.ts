import type { ClinicalProtocolConfiguration, ProtocolActionReference, ProtocolCondition, ProtocolTemporalConstraint } from "@/models/protocol/ClinicalProtocolConfiguration";
import { ALS_CAPABILITY_STATUS } from "@/modules/als/AlsCapabilityStatus";
import { classifyCardiacRhythm } from "@/services/runtime/CardiacArrestPatientProcess";
import { calculateProtocolHash } from "./ProtocolConfigurationHash";

export type ProtocolDiagnosticCode = "INVALID_IDENTITY" | "INVALID_HASH" | "DUPLICATE_RULE" | "DUPLICATE_EXPECTATION" | "UNKNOWN_CAPABILITY" | "UNKNOWN_RHYTHM" | "CONTRADICTORY_RHYTHM_CATEGORY" | "UNKNOWN_ACTION" | "INVALID_TEMPORAL_CONSTRAINT" | "MALFORMED_MEDICATION_REFERENCE";
export type ProtocolDiagnostic = Readonly<{ code: ProtocolDiagnosticCode; path: string; message: string }>;

const rhythms = ["VF", "PULSELESS_VT", "PEA", "ASYSTOLE", "PERFUSING"] as const;
const actions: readonly ProtocolActionReference[] = ["AIRWAY_INTERVENTION", "DEFIBRILLATION", "MEDICATION_ADMINISTRATION", "START_CPR", "STOP_CPR"];
const capabilities = new Set(ALS_CAPABILITY_STATUS.map(item => item.capabilityId));
const duplicates = (values: readonly string[]) => [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort();

function validateCondition(value: ProtocolCondition, path: string, add: (code: ProtocolDiagnosticCode, path: string, message: string) => void): void {
  if (value.rhythm && !rhythms.includes(value.rhythm)) add("UNKNOWN_RHYTHM", `${path}.rhythm`, `Unknown canonical rhythm ${value.rhythm}`);
  if (value.rhythm && value.rhythmClassification && classifyCardiacRhythm(value.rhythm) !== value.rhythmClassification) add("CONTRADICTORY_RHYTHM_CATEGORY", path, `${value.rhythm} is canonically ${classifyCardiacRhythm(value.rhythm)}`);
}
function validateTemporal(value: ProtocolTemporalConstraint | undefined, path: string, add: (code: ProtocolDiagnosticCode, path: string, message: string) => void): void {
  if (!value) return;
  if ((value.relation === "WITHIN" || value.relation === "REPEATING") && (!Number.isFinite(value.durationSec) || Number(value.durationSec) <= 0)) add("INVALID_TEMPORAL_CONSTRAINT", path, `${value.relation} requires positive durationSec`);
  if (value.referenceAction && !actions.includes(value.referenceAction)) add("UNKNOWN_ACTION", `${path}.referenceAction`, `Unknown action ${value.referenceAction}`);
}

export class ProtocolConfigurationValidator {
  validate(protocol: ClinicalProtocolConfiguration): readonly ProtocolDiagnostic[] {
    const issues: ProtocolDiagnostic[] = []; const add = (code: ProtocolDiagnosticCode, path: string, message: string) => issues.push(Object.freeze({ code, path, message }));
    if (!protocol.protocolId.trim() || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(protocol.version)) add("INVALID_IDENTITY", "identity", "Protocol requires a non-empty ID and exact semantic version");
    const { protocolHash: _hash, ...content } = protocol;
    if (calculateProtocolHash(content) !== protocol.protocolHash) add("INVALID_HASH", "protocolHash", "Protocol hash mismatch");
    duplicates(protocol.rules.map(item => item.ruleId)).forEach(id => add("DUPLICATE_RULE", "rules", `Duplicate rule ${id}`));
    duplicates(protocol.assessmentExpectations.map(item => item.expectationId)).forEach(id => add("DUPLICATE_EXPECTATION", "assessmentExpectations", `Duplicate expectation ${id}`));
    protocol.requiredCapabilities.filter(value => !capabilities.has(value)).forEach(value => add("UNKNOWN_CAPABILITY", "requiredCapabilities", `Unknown capability ${value}`));
    protocol.rules.forEach((rule, index) => { validateCondition(rule.condition, `rules[${index}].condition`, add); if (!actions.includes(rule.action)) add("UNKNOWN_ACTION", `rules[${index}].action`, `Unknown action ${rule.action}`); validateTemporal(rule.temporalConstraint, `rules[${index}].temporalConstraint`, add); });
    protocol.assessmentExpectations.forEach((item, index) => { validateCondition(item.condition, `assessmentExpectations[${index}].condition`, add); if (!actions.includes(item.expectedAction)) add("UNKNOWN_ACTION", `assessmentExpectations[${index}].expectedAction`, `Unknown action ${item.expectedAction}`); validateTemporal(item.temporalConstraint, `assessmentExpectations[${index}].temporalConstraint`, add); });
    for (const [category, values] of Object.entries(protocol.rhythmCategories)) values.forEach((rhythm, index) => { if (!rhythms.includes(rhythm)) add("UNKNOWN_RHYTHM", `rhythmCategories.${category}[${index}]`, `Unknown canonical rhythm ${rhythm}`); else if (classifyCardiacRhythm(rhythm) !== category) add("CONTRADICTORY_RHYTHM_CATEGORY", `rhythmCategories.${category}[${index}]`, `${rhythm} cannot be classified as ${category}`); });
    protocol.medicationReferences.forEach((item, index) => { if (!item.medicationRef.trim() || !item.context.trim()) add("MALFORMED_MEDICATION_REFERENCE", `medicationReferences[${index}]`, "Medication reference and context are required"); });
    return Object.freeze(issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code)));
  }
  assertValid(protocol: ClinicalProtocolConfiguration): void { const issues = this.validate(protocol); if (issues.length) throw new Error(`INVALID_PROTOCOL_CONFIGURATION:${issues.map(item => `${item.code}@${item.path}`).join(",")}`); }
}
