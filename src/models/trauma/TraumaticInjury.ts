import { deepFreeze } from "@/utils/immutable";

export const TRAUMA_MECHANISMS = Object.freeze(["FALL_FROM_HEIGHT", "MOTOR_VEHICLE_COLLISION"] as const);
export const TRAUMA_ANATOMIC_REGIONS = Object.freeze(["PELVIS", "THORAX"] as const);
export type TraumaMechanism = typeof TRAUMA_MECHANISMS[number];
export type TraumaAnatomicRegion = typeof TRAUMA_ANATOMIC_REGIONS[number];

export type TraumaticInjuryDescriptor = Readonly<{
  injuryId: string;
  injuryType?: string;
  mechanism: TraumaMechanism;
  anatomicRegion: TraumaAnatomicRegion;
  laterality?: "LEFT" | "RIGHT" | "BILATERAL" | "MIDLINE";
  woundClassification?: "OPEN" | "CLOSED";
  provenance?: Readonly<{ moduleId: string; version: string }>;
}>;

export function createTraumaticInjuryDescriptor(input: TraumaticInjuryDescriptor): TraumaticInjuryDescriptor {
  if (!input.injuryId.trim()) throw new Error("INVALID_TRAUMATIC_INJURY_ID");
  if (!TRAUMA_MECHANISMS.includes(input.mechanism)) throw new Error("INVALID_TRAUMA_MECHANISM");
  if (!TRAUMA_ANATOMIC_REGIONS.includes(input.anatomicRegion)) throw new Error("INVALID_TRAUMA_ANATOMIC_REGION");
  return deepFreeze(structuredClone(input));
}
