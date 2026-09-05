import type { InterventionDefinition, ResourceRequirement } from "@/models/InterventionDefinition";
import type { RuntimeResource, ResourceType } from "@/models/ResourceRuntime";

export function resourceRequirementTypes(requirement: ResourceRequirement): readonly ResourceType[] {
  return requirement.oneOfResourceTypes ?? (requirement.resourceType ? [requirement.resourceType] : []);
}

export function resourceMatchesRequirement(resource: RuntimeResource, requirement: ResourceRequirement): boolean {
  return resourceRequirementTypes(requirement).includes(resource.type);
}

/** Validates an exact, non-overlapping selection against a definition. */
export function validateInterventionResourceSelection(
  definition: InterventionDefinition,
  resources: readonly RuntimeResource[]
): void {
  const remaining = [...resources];
  for (const requirement of definition.requiredResources) {
    const matches = remaining.filter(resource => resourceMatchesRequirement(resource, requirement));
    const minimum = requirement.optional ? 0 : requirement.quantity;
    if (matches.length < minimum || matches.length > requirement.quantity) {
      throw new Error(`RESOURCE_REQUIREMENT:${resourceRequirementTypes(requirement).join("|")}`);
    }
    for (const match of matches) remaining.splice(remaining.findIndex(item => item.resourceId === match.resourceId), 1);
  }
  if (remaining.length) throw new Error("RESOURCE_REQUIREMENT:UNEXPECTED_RESOURCE");
}
