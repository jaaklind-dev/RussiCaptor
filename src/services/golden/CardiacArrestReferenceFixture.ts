import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import { defaultCardiacArrestConfiguration } from "@/services/runtime/CardiacArrestPatientProcess";

export const CARDIAC_ARREST_REFERENCE_FIXTURE: GoldenFixture = Object.freeze({
  fixtureId: "FX-CARDIAC-ARREST-REFERENCE", fixtureType: "PROCESS", patientId: "PT-CARDIAC-REFERENCE",
  seed: 36, clockState: "RUNNING", ownershipVersion: 1, activeResources: {}, loadedModules: ["CARDIAC_ARREST_V1"],
  initialState: Object.freeze({ processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV-CARDIAC-REFERENCE",
    ventilationReserve: 100, reserveLossPerMin: 0, co2Burden: 40, co2GainPerMin: 0,
    cardiacArrest: Object.freeze({ processId: "CARDIAC-REFERENCE", configuration: {
      ...structuredClone(defaultCardiacArrestConfiguration), initialRhythm: "PEA" as const,
      transitions: Object.freeze([
        Object.freeze({ transitionId: "PEA-TO-VF", trigger: "TIME" as const, fromRhythm: "PEA" as const, toRhythm: "VF" as const, atSec: 30, priority: 100 }),
        Object.freeze({ transitionId: "VF-SHOCK-ROSC", trigger: "SHOCK" as const, fromRhythm: "VF" as const, toRhythm: "PERFUSING" as const, shockAttempt: 1, priority: 100 }),
      ]),
    } }),
  }),
});

export const CARDIAC_ARREST_REFERENCE_TICK: GoldenInputEvent = Object.freeze({
  sequenceId: "SEQ-CARDIAC-REFERENCE", step: 1, offsetSec: 30, eventType: "ENGINE_TICK", actor: "ENGINE",
  target: "PT-CARDIAC-REFERENCE", eventId: "TICK-CARDIAC-REFERENCE", result: "SUCCESS", payload: { tickMin: 0.5 },
});
