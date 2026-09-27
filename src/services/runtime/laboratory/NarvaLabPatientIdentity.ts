import type { LabAuthoredSampleResults, LabPatientBloodIdentity } from "@/models/LaboratoryWorkflow";

function stablePatientHash(patientId: string): number {
  let value = 2_166_136_261;
  for (let index = 0; index < patientId.length; index += 1) {
    value ^= patientId.charCodeAt(index);
    value = Math.imul(value, 16_777_619);
  }
  return value >>> 0;
}

/**
 * Stable fallback for scenarios that do not define a blood-bank identity. It is
 * patient identity data, not a per-sample random laboratory value.
 */
export function deriveNarvaLabPatientBloodIdentity(patientId: string): LabPatientBloodIdentity {
  const hash = stablePatientHash(patientId);
  const groups: readonly LabPatientBloodIdentity["ab0"][] = ["O", "A", "B", "AB"];
  return Object.freeze({ ab0: groups[hash % groups.length],
    rhd: hash % 7 === 0 ? "NEGATIVE" : "POSITIVE" });
}

/** Explicit Narva scenario authoring; absence must not imply a negative screening result. */
const NARVA_AUTHORED_SAMPLE_RESULTS: Readonly<Record<string, LabAuthoredSampleResults>> = Object.freeze({
  "PT-PELVIC-001": Object.freeze({ antibodyScreen: "NEGATIVE" }),
  "PT-CHEST-001": Object.freeze({ antibodyScreen: "NEGATIVE" }),
});

export function authoredNarvaLabSampleResults(patientId: string): LabAuthoredSampleResults | undefined {
  return NARVA_AUTHORED_SAMPLE_RESULTS[patientId];
}
