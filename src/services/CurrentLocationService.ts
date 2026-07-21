import type { LocationZone } from "@/models/LocationZone";
import { findLocationZoneById, getLocationZones } from "@/repositories/LocationRepository";
import { getCurrentCaseManager } from "@/services/CurrentUserService";
import { notifySync } from "@/services/SyncService";

const defaultZoneId = "LOC-001";
let caseManagerZoneIds: Record<string, string> = {};

export function getCurrentLocationZone(): LocationZone | undefined {
  const caseManagerId = getCurrentCaseManager().id;
  const zoneId = caseManagerZoneIds[caseManagerId] ?? defaultZoneId;
  return findLocationZoneById(zoneId) ?? getLocationZones()[0];
}

export function setCurrentLocationZone(zone: LocationZone): void {
  caseManagerZoneIds = {
    ...caseManagerZoneIds,
    [getCurrentCaseManager().id]: zone.id,
  };
  notifySync();
}

export function getCaseManagerLocationState(): Record<string, string> {
  return { ...caseManagerZoneIds };
}

export function restoreCaseManagerLocationState(
  restored: Record<string, string>
): void {
  caseManagerZoneIds = { ...restored };
}

export function resetCaseManagerLocations(): void {
  caseManagerZoneIds = {};
}
