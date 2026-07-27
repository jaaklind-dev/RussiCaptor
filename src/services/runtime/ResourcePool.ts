import type { RuntimeResource } from "@/models/ResourceRuntime";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

export class ResourcePool {
  private readonly resources = new Map<string, RuntimeResource>();

  constructor(resources: RuntimeResource[] = []) {
    for (const resource of [...resources].sort((a, b) => a.resourceId.localeCompare(b.resourceId))) {
      if (!resource.resourceId) throw new Error("Resource resourceId ei tohi olla tühi.");
      if (this.resources.has(resource.resourceId)) throw new Error(`Resource ${resource.resourceId} esineb mitu korda.`);
      this.resources.set(resource.resourceId, structuredClone(resource));
    }
  }

  update(_timestamp: number): void {
    // Foundation hook future expiry/maintenance rules; intentionally deterministic no-op in WP-9.
  }

  reserve(resourceId: string, patientId: string): RuntimeResource {
    const resource = this.require(resourceId);
    if (!patientId) throw new Error("Resource reserve vajab patientId väärtust.");
    if (resource.status !== "AVAILABLE" || resource.assignedPatientId) {
      throw new Error(`Resource ${resourceId} pole saadaval.`);
    }
    const reserved: RuntimeResource = { ...resource, status: "RESERVED", assignedPatientId: patientId };
    this.resources.set(resourceId, reserved);
    return structuredClone(reserved);
  }

  release(resourceId: string): RuntimeResource {
    const resource = this.require(resourceId);
    if (resource.status !== "RESERVED" || !resource.assignedPatientId) {
      throw new Error(`Resource ${resourceId} pole reserveeritud.`);
    }
    const released: RuntimeResource = { ...resource, status: "AVAILABLE", assignedPatientId: undefined };
    this.resources.set(resourceId, released);
    return structuredClone(released);
  }

  isAvailable(resourceId: string): boolean {
    const resource = this.resources.get(resourceId);
    return Boolean(resource && resource.status === "AVAILABLE" && !resource.assignedPatientId);
  }

  getAssignedResources(patientId: string): RuntimeResource[] {
    return this.snapshot().filter(resource => resource.assignedPatientId === patientId);
  }

  snapshot(): RuntimeResource[] {
    return [...this.resources.values()]
      .sort((a, b) => a.resourceId.localeCompare(b.resourceId))
      .map(resource => structuredClone(resource));
  }

  hash(): string {
    return sha256Text(stableJson(this.snapshot()));
  }

  private require(resourceId: string): RuntimeResource {
    const resource = this.resources.get(resourceId);
    if (!resource) throw new Error(`Resource ${resourceId} puudub.`);
    return resource;
  }
}
