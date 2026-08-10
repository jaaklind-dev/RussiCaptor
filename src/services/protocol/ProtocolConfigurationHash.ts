import type { ClinicalProtocolConfiguration } from "@/models/protocol/ClinicalProtocolConfiguration";
import { deepFreeze } from "@/utils/immutable";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

const strings = (values: readonly string[]) => [...values].sort((a, b) => a.localeCompare(b));
const byId = <T>(values: readonly T[], id: (value: T) => string) => [...values].sort((a, b) => id(a).localeCompare(id(b)));

export function protocolHashInput(input: Omit<ClinicalProtocolConfiguration, "protocolHash">): unknown {
  const { protocolHash: _ignored, ...semantic } = input as ClinicalProtocolConfiguration;
  return {
    ...semantic,
    tags: strings(semantic.tags),
    requiredCapabilities: strings(semantic.requiredCapabilities),
    rhythmCategories: {
      NON_SHOCKABLE: strings(semantic.rhythmCategories.NON_SHOCKABLE),
      PERFUSING: strings(semantic.rhythmCategories.PERFUSING),
      SHOCKABLE: strings(semantic.rhythmCategories.SHOCKABLE),
    },
    rules: byId(semantic.rules, item => item.ruleId),
    assessmentExpectations: byId(semantic.assessmentExpectations, item => item.expectationId)
      .map(item => ({ ...item, evidenceRequirements: strings(item.evidenceRequirements) })),
    medicationReferences: byId(semantic.medicationReferences, item => `${item.medicationRef}\0${item.context}\0${item.route ?? ""}\0${item.dose ?? ""}`),
  };
}

export const calculateProtocolHash = (input: Omit<ClinicalProtocolConfiguration, "protocolHash">): string =>
  sha256Text(stableJson(protocolHashInput(input)));

export function createProtocolConfiguration(input: Omit<ClinicalProtocolConfiguration, "protocolHash">): ClinicalProtocolConfiguration {
  const canonical = protocolHashInput(structuredClone(input)) as Omit<ClinicalProtocolConfiguration, "protocolHash">;
  return deepFreeze({ ...canonical, protocolHash: calculateProtocolHash(canonical) }) as ClinicalProtocolConfiguration;
}
