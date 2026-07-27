import type { OwnershipRule } from "@/models/ModuleImport";

export type RuntimeContributionChannel =
  | "DIRECT_WRITE"
  | "PROCESS_CONTRIBUTION"
  | "CHILD_PROCESS_TRIGGER"
  | "OBSERVATION_EVENT"
  | "CORE_SERVICE";

export type RuntimeWriterKind = "MODULE" | "PROCESS" | "OBSERVATION_EVENT" | "CORE_SERVICE";

export type RuntimeWriteRequest = {
  objectType: string;
  field: string;
  writerId: string;
  writerKind: RuntimeWriterKind;
  channel: RuntimeContributionChannel;
  attributed: boolean;
  active: boolean;
};

export type RuntimeContributorPolicy = {
  explicitIds: string[];
  allowAllActiveModules: boolean;
  allowAllActiveProcesses: boolean;
  allowOtherModules: boolean;
  allowOtherProcesses: boolean;
  allowObservationEvents: boolean;
  childProcessTriggerOnly: boolean;
  attributionRequired: boolean;
};

export type RuntimeFieldOwnership = {
  objectType: string;
  field: string;
  canonicalOwner: string;
  contributionAllowedFrom: string;
  contributors: RuntimeContributorPolicy;
  aggregationOrWriteRule: string;
  conflictAction: string;
};

export type RuntimeWriteDecision = {
  accepted: boolean;
  mode: "OWNER_WRITE" | "CONTRIBUTION" | "REJECTED";
  ownership: RuntimeFieldOwnership;
  reason: string;
  conflictAction?: string;
};

function key(objectType: string, field: string): string {
  return `${objectType.trim().toUpperCase()}\u0000${field.trim().toLowerCase()}`;
}

function fieldAliases(value: string): string[] {
  return [...new Set([
    value.trim(),
    ...value.split("/").map((part) => part.trim()),
  ].filter(Boolean))];
}

function explicitContributorIds(value: string): string[] {
  return [...new Set(value.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? [])];
}

export function parseContributorPolicy(value: string): RuntimeContributorPolicy {
  const lower = value.toLowerCase();
  return {
    explicitIds: explicitContributorIds(value),
    allowAllActiveModules: lower.includes("all active modules"),
    allowAllActiveProcesses: lower.includes("all active processes"),
    allowOtherModules: lower.includes("other modules"),
    allowOtherProcesses: lower.includes("other processes"),
    allowObservationEvents: lower.includes("observation events"),
    childProcessTriggerOnly: lower.includes("child-process triggers only"),
    attributionRequired: lower.includes("attribution") ||
      lower.includes("other modules") || lower.includes("other processes"),
  };
}

function contributorAllowed(
  request: RuntimeWriteRequest,
  policy: RuntimeContributorPolicy,
  canonicalOwner: string
): boolean {
  if (!request.active) return false;
  if (policy.childProcessTriggerOnly && request.channel !== "CHILD_PROCESS_TRIGGER") return false;
  if (policy.attributionRequired && !request.attributed) return false;
  if (policy.explicitIds.includes(request.writerId)) return true;
  if (request.writerId === "CORE_ENGINE" && policy.explicitIds.includes("CORE_ENGINE")) return true;
  if (request.writerKind === "OBSERVATION_EVENT") return policy.allowObservationEvents;
  if (request.writerKind === "MODULE") {
    return policy.allowAllActiveModules || (policy.allowOtherModules && request.writerId !== canonicalOwner);
  }
  if (request.writerKind === "PROCESS") {
    return policy.allowAllActiveProcesses || policy.allowOtherProcesses;
  }
  return request.writerKind === "CORE_SERVICE" && policy.explicitIds.includes("CORE_ENGINE");
}

export class RuntimeOwnershipResolver {
  private readonly rules = new Map<string, RuntimeFieldOwnership>();

  constructor(rules: OwnershipRule[]) {
    for (const rule of rules) {
      if (
        !rule.objectType || !rule.objectOrField || !rule.canonicalOwner ||
        !rule.contributionAllowedFrom || !rule.aggregationOrWriteRule || !rule.conflictAction
      ) {
        throw new Error("OwnershipMap sisaldab mittetäielikku reeglit.");
      }
      const ownershipBase = {
        objectType: rule.objectType,
        canonicalOwner: rule.canonicalOwner,
        contributionAllowedFrom: rule.contributionAllowedFrom,
        contributors: parseContributorPolicy(rule.contributionAllowedFrom),
        aggregationOrWriteRule: rule.aggregationOrWriteRule,
        conflictAction: rule.conflictAction,
      };
      for (const field of fieldAliases(rule.objectOrField)) {
        const ruleKey = key(rule.objectType, field);
        if (this.rules.has(ruleKey)) {
          throw new Error(`${rule.objectType}/${field} ownership-reegel esineb mitu korda.`);
        }
        this.rules.set(ruleKey, { ...ownershipBase, field });
      }
    }
  }

  resolve(objectType: string, field: string): RuntimeFieldOwnership {
    const ownership = this.rules.get(key(objectType, field));
    if (!ownership) throw new Error(`${objectType}/${field} ownership-reegel puudub.`);
    return ownership;
  }

  authorize(request: RuntimeWriteRequest): RuntimeWriteDecision {
    const ownership = this.resolve(request.objectType, request.field);
    if (request.writerId === ownership.canonicalOwner) {
      return {
        accepted: true,
        mode: "OWNER_WRITE",
        ownership,
        reason: `${request.writerId} on välja canonical owner.`,
      };
    }
    if (request.channel === "DIRECT_WRITE") {
      return {
        accepted: false,
        mode: "REJECTED",
        ownership,
        reason: `${request.writerId} ei tohi kirjutada ${request.field} välja otse.`,
        conflictAction: ownership.conflictAction,
      };
    }
    if (contributorAllowed(request, ownership.contributors, ownership.canonicalOwner)) {
      return {
        accepted: true,
        mode: "CONTRIBUTION",
        ownership,
        reason: `${request.writerId} panus on lubatud ja lahendatakse reegliga ${ownership.aggregationOrWriteRule}`,
      };
    }
    return {
      accepted: false,
      mode: "REJECTED",
      ownership,
      reason: `${request.writerId} panus pole ${request.field} ownership-reegliga lubatud.`,
      conflictAction: ownership.conflictAction,
    };
  }
}

