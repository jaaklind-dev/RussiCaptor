import type { RuntimeResource } from "@/models/ResourceRuntime";

export type EndotrachealIntubationOptions = Readonly<{
  tubes: RuntimeResource[];
  laryngoscopes: RuntimeResource[];
  capnography: RuntimeResource[];
  available: boolean;
}>;

export function selectEndotrachealIntubationOptions(resources: readonly RuntimeResource[]): EndotrachealIntubationOptions {
  const available = resources.filter(item => item.status === "AVAILABLE" && !item.assignedPatientId);
  const tubes = available.filter(item => item.type === "endotrachealTube");
  const laryngoscopes = available.filter(item => item.type === "directLaryngoscope" || item.type === "videoLaryngoscope");
  const capnography = available.filter(item => item.type === "capnography");
  return { tubes, laryngoscopes, capnography, available: tubes.length > 0 && laryngoscopes.length > 0 };
}

export function airwayResourceLabel(resource: RuntimeResource): string {
  const label = resource.metadata.label ?? resource.metadata.displayName;
  if (typeof label === "string" && label.trim()) return label;
  if (resource.type === "endotrachealTube") {
    const size = resource.metadata.tubeSize;
    return typeof size === "number" ? `Endotrahheaaltoru ${size}` : "Endotrahheaaltoru";
  }
  if (resource.type === "videoLaryngoscope") return "Videolarüngoskoop";
  if (resource.type === "directLaryngoscope") return "Otsene larüngoskoop";
  return "Kapnograaf";
}
