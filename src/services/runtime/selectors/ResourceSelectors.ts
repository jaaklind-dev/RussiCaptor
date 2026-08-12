import type { ResourceType, RuntimeResource } from "@/models/ResourceRuntime";
import type { ClinicalResourceType, ResourceAllocationRuntimeState } from "@/models/ResourceAllocation";

const typeOrder: ResourceType[] = [
  "oxygen", "nasalCannula", "simpleMask", "nonRebreatherMask", "oxygenMask",
  "oropharyngealAirway", "nasopharyngealAirway", "iGel", "laryngealMask",
  "bagValveMask", "BVM", "endotrachealTube", "videoLaryngoscope",
  "directLaryngoscope", "ventilator", "suction", "capnography", "monitor",
  "peripheralIV", "centralVenousCatheter", "intraosseousAccess", "pressureBag",
  "fluidWarmer", "infusionPump", "bloodAdministrationSet", "rapidInfuser",
  "tourniquet", "pelvicBinder", "chestDrain",
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
  peripheralIV: "Peripheral IV",
  centralVenousCatheter: "Central venous catheters",
  intraosseousAccess: "IO access",
  pressureBag: "Pressure bags",
  fluidWarmer: "Fluid warmers",
  infusionPump: "Infusion pumps",
  bloodAdministrationSet: "Blood administration sets",
  rapidInfuser: "Rapid infusers",
  tourniquet: "Tourniquets",
  pelvicBinder: "Pelvic binders",
  chestDrain: "Chest drains",
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

export type CanonicalResourceMonitorRow = {
  type: ClinicalResourceType;
  label: string;
  total: number;
  free: number;
  inUse: number;
  waiting: number;
  activePatientIds: readonly string[];
};

/** Read-only projection. Capacity and queue truth remain in ResourceAllocationRuntimeState. */
export function summarizeCanonicalResources(state: ResourceAllocationRuntimeState): CanonicalResourceMonitorRow[] {
  const active = state.allocations.filter(item => item.status === "ACTIVE");
  const waiting = state.requests.filter(item => item.status === "WAITING");
  return [...state.configuration.resources].sort((a, b) => a.resourceType.localeCompare(b.resourceType)).map(definition => {
    const matching = active.filter(allocation => allocation.resources.some(item => item.resourceType === definition.resourceType));
    const inUse = matching.flatMap(item => item.resources).filter(item => item.resourceType === definition.resourceType)
      .reduce((sum, item) => sum + item.quantity, 0);
    return {
      type: definition.resourceType,
      label: definition.resourceType.split("_").map(item => item[0] + item.slice(1).toLowerCase()).join(" "),
      total: definition.capacity, free: definition.capacity - inUse, inUse,
      waiting: waiting.filter(request => request.requirements.some(item => item.resourceType === definition.resourceType && !item.optional)).length,
      activePatientIds: [...new Set(matching.map(item => item.patientId))].sort(),
    };
  });
}
