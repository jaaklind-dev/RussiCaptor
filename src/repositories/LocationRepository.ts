import { locationZones } from "@/data/locationZones";
import type { LocationZone } from "@/models/LocationZone";

export function getLocationZones() {
  return locationZones.filter((zone) => zone.visibility === "available");
}

export function findLocationZoneByCode(code: string) {
  const normalizedCode = code.trim().toUpperCase();
  return getLocationZones().find(
    (zone) => zone.code.toUpperCase() === normalizedCode
  );
}

export function findLocationZoneById(zoneId: string) {
  return getLocationZones().find((zone) => zone.id === zoneId);
}

export function installLocationZones(zones: LocationZone[]): void {
  locationZones.splice(
    0,
    locationZones.length,
    ...zones.map((zone) => ({ ...zone }))
  );
}
