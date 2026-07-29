import type { ClinicalParameterValue } from "@/models/ClinicalIntegration";
import type { InterventionDefinition } from "@/models/InterventionDefinition";

function validateDefinition(definition: InterventionDefinition): void {
  if (!definition.definitionId || !definition.version || !definition.name) {
    throw new Error("InterventionDefinition identity on puudulik.");
  }
  if (definition.requiredResources.some(item => !item.resourceType || !Number.isInteger(item.quantity) || item.quantity < 1)) {
    throw new Error(`InterventionDefinition ${definition.definitionId} resource requirement on vigane.`);
  }
  if (definition.duration.kind === "FIXED" &&
    (!Number.isFinite(definition.duration.durationSec) || definition.duration.durationSec <= 0)) {
    throw new Error(`InterventionDefinition ${definition.definitionId} duration on vigane.`);
  }
}

export class InterventionDefinitionRegistry {
  private readonly definitions = new Map<string, InterventionDefinition>();

  constructor(definitions: InterventionDefinition[] = []) {
    [...definitions].sort((a, b) => a.definitionId.localeCompare(b.definitionId)).forEach(item => this.register(item));
  }

  register(definition: InterventionDefinition): void {
    validateDefinition(definition);
    if (this.definitions.has(definition.definitionId)) {
      throw new Error(`InterventionDefinition ${definition.definitionId} esineb mitu korda.`);
    }
    this.definitions.set(definition.definitionId, structuredClone(definition));
  }

  get(definitionId: string): InterventionDefinition | undefined {
    const definition = this.definitions.get(definitionId);
    return definition ? structuredClone(definition) : undefined;
  }

  normalizeParameters(
    definition: InterventionDefinition,
    source: Record<string, ClinicalParameterValue> = {}
  ): Record<string, ClinicalParameterValue> {
    const normalized: Record<string, ClinicalParameterValue> = {};
    for (const parameter of definition.parameters) {
      const value = source[parameter.name] ?? parameter.defaultValue;
      if (value === undefined || value === null) {
        if (parameter.required) throw new Error(`Intervention parameter ${parameter.name} puudub.`);
        continue;
      }
      const validType = parameter.type === "NUMBER" ? typeof value === "number" && Number.isFinite(value)
        : parameter.type === "STRING" ? typeof value === "string"
          : typeof value === "boolean";
      if (!validType) throw new Error(`Intervention parameter ${parameter.name} tüüp on vigane.`);
      if (typeof value === "number" &&
        ((parameter.min !== undefined && value < parameter.min) ||
          (parameter.max !== undefined && value > parameter.max))) {
        throw new Error(`Intervention parameter ${parameter.name} on lubatud vahemikust väljas.`);
      }
      normalized[parameter.name] = value;
    }
    return normalized;
  }

  snapshot(): InterventionDefinition[] {
    return [...this.definitions.values()]
      .sort((a, b) => a.definitionId.localeCompare(b.definitionId))
      .map(item => structuredClone(item));
  }
}
