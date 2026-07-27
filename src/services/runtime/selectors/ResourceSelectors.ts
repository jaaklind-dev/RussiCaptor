import type { ResourceType, RuntimeResource } from "@/models/ResourceRuntime";

const typeOrder: ResourceType[] = [
  "oxygen", "oxygenMask", "BVM", "ventilator", "endotrachealTube", "monitor",
];

const labels: Record<ResourceType, string> = {
  oxygen: "Oxygen",
  oxygenMask: "Oxygen masks",
  BVM: "BVM",
  ventilator: "Ventilators",
  endotrachealTube: "ET tubes",
  monitor: "Monitors",
};

export type ResourceMonitorRow = {
  type: ResourceType;
  label: string;
  total: number;
  free: number;
  inUse: number;
};

export function summarizeResources(resources: RuntimeResource[]): ResourceMonitorRow[] {
  return typeOrder.flatMap(type => {
    const matching = resources.filter(resource => resource.type === type);
    if (matching.length === 0) return [];
    const free = matching.filter(resource =>
      resource.status === "AVAILABLE" && !resource.assignedPatientId
    ).length;
    return [{ type, label: labels[type], total: matching.length, free, inUse: matching.length - free }];
  });
}
