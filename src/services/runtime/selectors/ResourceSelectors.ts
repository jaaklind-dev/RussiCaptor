import type { ResourceType, RuntimeResource } from "@/models/ResourceRuntime";

const typeOrder: ResourceType[] = [
  "oxygen", "nasalCannula", "simpleMask", "nonRebreatherMask", "oxygenMask",
  "oropharyngealAirway", "nasopharyngealAirway", "iGel", "laryngealMask",
  "bagValveMask", "BVM", "endotrachealTube", "videoLaryngoscope",
  "directLaryngoscope", "ventilator", "suction", "capnography", "monitor",
];

const labels: Record<ResourceType, string> = {
  oxygen: "Oxygen",
  oxygenMask: "Oxygen masks",
  nasalCannula: "Nasal cannulas",
  simpleMask: "Simple masks",
  nonRebreatherMask: "Non-rebreather masks",
  BVM: "BVM",
  bagValveMask: "BVM",
  oropharyngealAirway: "OPA",
  nasopharyngealAirway: "NPA",
  iGel: "Supraglottic (i-gel)",
  laryngealMask: "Supraglottic (LMA)",
  ventilator: "Ventilators",
  endotrachealTube: "ET tubes",
  videoLaryngoscope: "Video laryngoscopes",
  directLaryngoscope: "Direct laryngoscopes",
  suction: "Suction",
  capnography: "Capnography",
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
