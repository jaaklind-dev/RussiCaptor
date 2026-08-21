import type { BloodProductType, MassiveTransfusionConfiguration, MassiveTransfusionEvidence, MassiveTransfusionPatientProcessRuntime } from "@/models/MassiveTransfusion";
import type { ProcessOutput } from "@/models/RuntimeAggregation";

const precise = (value: number) => {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
};
function output(p: Omit<MassiveTransfusionPatientProcessRuntime, "outputs">): ProcessOutput {
  const factor = p.clinicalState.transfusedVolumeMl / 1000; const response = p.configuration.vitalResponsePer1000Ml;
  return { processId: p.processId, encounterId: p.encounterId, moduleId: "MASSIVE_TRANSFUSION_V1", status: p.state,
    globalSeverityScore: 0,
    vitalContributions: [
      { vital: "heartRate", operation: "DELTA", value: precise(response.heartRateDelta * factor) },
      { vital: "systolicBp", operation: "DELTA", value: precise(response.systolicBpDelta * factor) },
      { vital: "diastolicBp", operation: "DELTA", value: precise(response.diastolicBpDelta * factor) },
      { vital: "crt", operation: "DELTA", value: precise(response.crtDelta * factor) },
    ],
    runtimeContributions: { mtpActivated: p.clinicalState.activated, transfusedVolumeMl: p.clinicalState.transfusedVolumeMl,
      oxygenCarryingCapacity: p.clinicalState.oxygenCarryingCapacity, coagulationSupport: p.clinicalState.coagulationSupport,
      bloodProductInventory: { ...p.clinicalState.inventory }, bloodProductsAdministered: { ...p.clinicalState.administeredUnits } }, observedAtSec: p.elapsedTime };
}
function withOutput(base: Omit<MassiveTransfusionPatientProcessRuntime, "outputs">): MassiveTransfusionPatientProcessRuntime { return { ...base, outputs: output(base) }; }

export function bootstrapMassiveTransfusionPatientProcess(encounterId: string, initial: Readonly<Record<string, unknown>>): MassiveTransfusionPatientProcessRuntime {
  const configuration = structuredClone(initial.configuration) as MassiveTransfusionConfiguration;
  if (!configuration?.products || !configuration.initialInventory) throw new Error("MTP_CONFIGURATION_INVALID");
  const calcium = configuration.calciumReplacement;
  if (calcium && (!Number.isInteger(calcium.rbcUnitsPerCalcium) || calcium.rbcUnitsPerCalcium <= 0 ||
    !calcium.calciumProduct.trim() || !calcium.calciumDose.trim() || !calcium.calciumRoute.trim())) throw new Error("MTP_CALCIUM_CONFIGURATION_INVALID");
  const base: Omit<MassiveTransfusionPatientProcessRuntime, "outputs"> = {
    processId: String(initial.processId ?? `${encounterId}:MASSIVE_TRANSFUSION`), encounterId,
    instanceKey: String(initial.instanceKey ?? `${encounterId}:massive-transfusion`), processType: "MASSIVE_TRANSFUSION",
    templateId: String(initial.templateId ?? "MTP_REFERENCE_V1"), state: "Active", elapsedTime: 0, nextTick: 60, configuration,
    clinicalState: { activated: false, inventory: { ...configuration.initialInventory }, administeredUnits: { RBC: 0, PLASMA: 0, PLATELETS: 0 },
      transfusedVolumeMl: 0, oxygenCarryingCapacity: 0, coagulationSupport: 0, administrations: [],
      completedRbcUnitsTotal: 0, completedRbcUnitsSinceLastCalcium: 0,
      rbcUnitsPerCalcium: calcium?.calciumEnabled ? calcium.rbcUnitsPerCalcium : null,
      calciumRecommended: false, calciumAdministrations: [], calciumLastAdministeredAt: null,
      calciumAdministrationCount: 0, processedCommandIds: [] }, pendingEvidence: [],
  };
  return withOutput(base);
}

export function administerMtpCalcium(previous: MassiveTransfusionPatientProcessRuntime, commandId: string): MassiveTransfusionPatientProcessRuntime {
  if (previous.clinicalState.processedCommandIds.includes(commandId)) return structuredClone(previous);
  const calcium = previous.configuration.calciumReplacement;
  if (!calcium?.calciumEnabled) throw new Error("MTP_CALCIUM_DISABLED");
  if (!previous.clinicalState.activated) throw new Error("MTP_NOT_ACTIVATED");
  const base = structuredClone(previous);
  base.clinicalState.processedCommandIds.push(commandId); base.clinicalState.processedCommandIds.sort();
  base.clinicalState.calciumAdministrations.push({ administrationId: commandId, product: calcium.calciumProduct,
    dose: calcium.calciumDose, route: calcium.calciumRoute, completedAtSec: base.elapsedTime });
  base.clinicalState.calciumAdministrationCount = base.clinicalState.calciumAdministrations.length;
  base.clinicalState.calciumLastAdministeredAt = base.elapsedTime;
  base.clinicalState.completedRbcUnitsSinceLastCalcium = 0; base.clinicalState.calciumRecommended = false;
  base.pendingEvidence.push({ eventType: "MTP_CALCIUM_ADMINISTERED", details: { commandId, product: calcium.calciumProduct,
    dose: calcium.calciumDose, route: calcium.calciumRoute, completedAtSec: base.elapsedTime } });
  const { outputs: _outputs, ...without } = base; return withOutput(without);
}

export function activateMassiveTransfusion(previous: MassiveTransfusionPatientProcessRuntime, commandId: string): MassiveTransfusionPatientProcessRuntime {
  if (previous.clinicalState.processedCommandIds.includes(commandId)) return structuredClone(previous);
  if (previous.clinicalState.activated) return structuredClone(previous);
  const base = structuredClone(previous); base.clinicalState.activated = true; base.clinicalState.activationId = commandId;
  base.clinicalState.processedCommandIds.push(commandId); base.clinicalState.processedCommandIds.sort();
  base.pendingEvidence.push({ eventType: "MTP_ACTIVATED", details: { commandId } });
  const { outputs: _outputs, ...without } = base; return withOutput(without);
}

export function startBloodProductAdministration(previous: MassiveTransfusionPatientProcessRuntime, commandId: string, product: BloodProductType, units: number): MassiveTransfusionPatientProcessRuntime {
  if (previous.clinicalState.processedCommandIds.includes(commandId)) return structuredClone(previous);
  if (!previous.clinicalState.activated) throw new Error("MTP_NOT_ACTIVATED");
  if (!Number.isInteger(units) || units <= 0) throw new Error("INVALID_BLOOD_PRODUCT_QUANTITY");
  if (previous.clinicalState.inventory[product] < units) throw new Error("BLOOD_PRODUCT_UNAVAILABLE");
  const base = structuredClone(previous); const definition = base.configuration.products[product];
  base.clinicalState.inventory[product] -= units; base.clinicalState.processedCommandIds.push(commandId); base.clinicalState.processedCommandIds.sort();
  base.clinicalState.administrations.push({ administrationId: commandId, product, units, totalVolumeMl: definition.volumeMlPerUnit * units,
    deliveredVolumeMl: 0, deliveredUnits: 0, state: "RUNNING" });
  base.clinicalState.administrations.sort((a, b) => a.administrationId.localeCompare(b.administrationId));
  base.pendingEvidence.push({ eventType: "BLOOD_PRODUCT_ADMINISTRATION_STARTED", details: { commandId, product, units } });
  const { outputs: _outputs, ...without } = base; return withOutput(without);
}

export function tickMassiveTransfusionPatientProcess(previous: MassiveTransfusionPatientProcessRuntime, seconds: number): MassiveTransfusionPatientProcessRuntime {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("INVALID_TICK_DURATION");
  const base = structuredClone(previous); const evidence: MassiveTransfusionEvidence[] = [];
  base.clinicalState.administrations = base.clinicalState.administrations.map(item => {
    if (item.state === "COMPLETED") return item;
    const definition = base.configuration.products[item.product];
    const deliveredVolumeMl = Math.min(item.totalVolumeMl, precise(item.deliveredVolumeMl + definition.administrationRateMlMin * seconds / 60));
    const deltaMl = deliveredVolumeMl - item.deliveredVolumeMl; const deliveredUnits = precise(deliveredVolumeMl / definition.volumeMlPerUnit);
    base.clinicalState.transfusedVolumeMl = precise(base.clinicalState.transfusedVolumeMl + deltaMl);
    base.clinicalState.oxygenCarryingCapacity = precise(base.clinicalState.oxygenCarryingCapacity + deltaMl / definition.volumeMlPerUnit * definition.oxygenCapacityPerUnit);
    base.clinicalState.coagulationSupport = precise(base.clinicalState.coagulationSupport + deltaMl / definition.volumeMlPerUnit * definition.coagulationContributionPerUnit);
    const state = deliveredVolumeMl >= item.totalVolumeMl ? "COMPLETED" as const : "RUNNING" as const;
    if (state === "COMPLETED") { base.clinicalState.administeredUnits[item.product] = precise(base.clinicalState.administeredUnits[item.product] + item.units);
      if (item.product === "RBC") {
        base.clinicalState.completedRbcUnitsTotal = precise(base.clinicalState.completedRbcUnitsTotal + item.units);
        base.clinicalState.completedRbcUnitsSinceLastCalcium = precise(base.clinicalState.completedRbcUnitsSinceLastCalcium + item.units);
        const calcium = base.configuration.calciumReplacement;
        if (calcium?.calciumEnabled && !base.clinicalState.calciumRecommended && base.clinicalState.completedRbcUnitsSinceLastCalcium >= calcium.rbcUnitsPerCalcium) {
          base.clinicalState.calciumRecommended = true;
          evidence.push({ eventType: "MTP_CALCIUM_DUE", details: { completedRbcUnitsTotal: base.clinicalState.completedRbcUnitsTotal,
            completedRbcUnitsSinceLastCalcium: base.clinicalState.completedRbcUnitsSinceLastCalcium, threshold: calcium.rbcUnitsPerCalcium } });
        }
      }
      evidence.push({ eventType: "BLOOD_PRODUCT_ADMINISTRATION_COMPLETED", details: { commandId: item.administrationId, product: item.product, units: item.units } }); }
    return { ...item, deliveredVolumeMl, deliveredUnits, state };
  });
  base.elapsedTime = precise(base.elapsedTime + seconds); base.nextTick = precise(base.nextTick + seconds); base.pendingEvidence.push(...evidence);
  const { outputs: _outputs, ...without } = base; return withOutput(without);
}

export function drainMassiveTransfusionEvidence(previous: MassiveTransfusionPatientProcessRuntime): { process: MassiveTransfusionPatientProcessRuntime; evidence: MassiveTransfusionEvidence[] } {
  const evidence = structuredClone(previous.pendingEvidence); const base = structuredClone(previous); base.pendingEvidence = [];
  return { process: base, evidence };
}
