import type { LocationZone } from "@/models/LocationZone";

export const locationZones: LocationZone[] = [
  {
    id: "LOC-001",
    exerciseId: "demo",
    code: "LOC-EMO-TRIAGE",
    name: "EMO triaaž",
    building: "Haigla",
    floor: "1",
    visibility: "available",
  },
  {
    id: "LOC-002",
    exerciseId: "demo",
    code: "LOC-ICU-2",
    name: "Intensiivravi",
    building: "Haigla",
    floor: "2",
    visibility: "available",
  },
];
