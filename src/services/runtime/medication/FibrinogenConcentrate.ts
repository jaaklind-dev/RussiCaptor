import type { MedicationDefinition } from "@/models/MedicationRuntime";

export const FIBRINOGEN_CONCENTRATE_ID = "FIBRINOGEN_CONCENTRATE" as const;
export const FIBRYGA_ALIAS = "FIBRYGA" as const;

/** Simulation product metadata. Dose remains an explicit gram value; vial count is never inferred. */
export const FIBRINOGEN_CONCENTRATE_DEFINITION: MedicationDefinition = Object.freeze({
  medicationId: FIBRINOGEN_CONCENTRATE_ID,
  name: "Fibrinogeenikontsentraat (Fibryga)",
  routes: ["IV" as const],
  category: "coagulationProduct",
  supportedEffects: [{ effectType: "COAGULATION_SUBSTRATE_SUPPORT" as const,
    parameters: { substanceId: FIBRINOGEN_CONCENTRATE_ID, productAlias: FIBRYGA_ALIAS } }],
  durationSec: 14_400,
  metadata: Object.freeze({ version: "FIBRINOGEN_CONCENTRATE_V1", aliases: Object.freeze([FIBRYGA_ALIAS]),
    doseUnit: "G", maximumDoseG: 20 }),
});
