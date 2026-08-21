import type { InterventionDefinition } from "@/models/InterventionDefinition";

const duration = { kind: "CONTINUOUS" as const };
const active = { kind: "ACTIVE_ENCOUNTER" as const };
const definition = (value: InterventionDefinition) => value;

export const circulationInterventionDefinitions: InterventionDefinition[] = [
  definition({ definitionId: "PERIPHERAL_IV_ACCESS", version: "1.0.0", name: "Peripheral IV access",
    requiredResources: [{ resourceType: "peripheralIV", quantity: 1 }], duration: { kind: "FIXED", durationSec: 180 },
    effects: [{ effectType: "VASCULAR_ACCESS_AVAILABLE", parameterMap: { accessType: "accessType", location: "location", gauge: "gauge" } }],
    parameters: [{ name: "accessType", type: "STRING", required: true, defaultValue: "PERIPHERAL_IV" },
      { name: "location", type: "STRING", required: true, defaultValue: "unspecified" },
      { name: "gauge", type: "NUMBER", required: true, defaultValue: 18, min: 10, max: 26 },
      { name: "attempts", type: "NUMBER", required: true, defaultValue: 1, min: 1, max: 20 }], preconditions: [active] }),
  definition({ definitionId: "INTRAOSSEOUS_ACCESS", version: "1.0.0", name: "Intraosseous access",
    requiredResources: [{ resourceType: "intraosseousAccess", quantity: 1 }], duration,
    effects: [{ effectType: "VASCULAR_ACCESS_AVAILABLE", parameterMap: { accessType: "accessType", location: "location", device: "device" } }],
    parameters: [{ name: "accessType", type: "STRING", required: true, defaultValue: "IO" },
      { name: "location", type: "STRING", required: true, defaultValue: "unspecified" },
      { name: "device", type: "STRING", required: true, defaultValue: "IO" }], preconditions: [active] }),
  definition({ definitionId: "CENTRAL_VENOUS_ACCESS", version: "1.0.0", name: "Central venous access",
    requiredResources: [{ resourceType: "centralVenousCatheter", quantity: 1 }], duration: { kind: "FIXED", durationSec: 600 },
    effects: [{ effectType: "VASCULAR_ACCESS_AVAILABLE", parameterMap: { accessType: "accessType", location: "location" } }],
    parameters: [{ name: "accessType", type: "STRING", required: true, defaultValue: "CENTRAL_ACCESS" },
      { name: "location", type: "STRING", required: true, defaultValue: "unspecified" }], preconditions: [active] }),
  ...(["CRYSTALLOID_INFUSION", "BLOOD_PRODUCT_ADMINISTRATION", "PRESSURE_INFUSION"] as const).map((id): InterventionDefinition => ({
    definitionId: id, version: "1.0.0", name: id.split("_").map(x => x[0] + x.slice(1).toLowerCase()).join(" "),
    requiredResources: [{ resourceType: id === "BLOOD_PRODUCT_ADMINISTRATION" ? "bloodAdministrationSet" : id === "PRESSURE_INFUSION" ? "pressureBag" : "infusionPump", quantity: 1 }],
    effects: [{ effectType: id === "BLOOD_PRODUCT_ADMINISTRATION" ? "BLOOD_PRODUCT_STARTED" : "INFUSION_RUNNING", parameterMap: { fluidType: "fluidType", volumeMl: "volumeMl", rateMlHour: "rateMlHour" } }], duration,
    parameters: [{ name: "fluidType", type: "STRING", required: true, defaultValue: id === "CRYSTALLOID_INFUSION" ? "crystalloid" : "packedRBC" },
      { name: "volumeMl", type: "NUMBER", required: true, defaultValue: 500, min: 1 },
      { name: "rateMlHour", type: "NUMBER", required: true, defaultValue: 500, min: 1 }], preconditions: [active],
  })),
  definition({ definitionId: "TOURNIQUET_APPLICATION", version: "1.0.0", name: "Tourniquet",
    requiredResources: [{ resourceType: "tourniquet", quantity: 1 }], duration,
    effects: [{ effectType: "REDUCE_EXTERNAL_BLEEDING", parameterMap: { limb: "limb", applicationTime: "applicationTime" } }],
    parameters: [{ name: "limb", type: "STRING", required: true },
      { name: "applicationTime", type: "NUMBER", required: true, min: 0 }], preconditions: [active] }),
  definition({ definitionId: "PELVIC_BINDER_APPLICATION", version: "1.0.0", name: "Pelvic binder",
    requiredResources: [{ resourceType: "pelvicBinder", quantity: 1 }], duration,
    effects: [{ effectType: "PELVIC_STABILIZATION", parameterMap: {} }], parameters: [], preconditions: [active] }),
];
