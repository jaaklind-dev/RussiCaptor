import type { BloodProductDeliveryMode, BloodProductType, MassiveTransfusionConfiguration, MassiveTransfusionEvidence, MassiveTransfusionPatientProcessRuntime, VascularAccessLineId } from "@/models/MassiveTransfusion";
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
  const delivery = configuration.bloodProductDelivery;
  if (calcium && (!Number.isInteger(calcium.rbcUnitsPerCalcium) || calcium.rbcUnitsPerCalcium <= 0 ||
    !calcium.calciumProduct.trim() || !calcium.calciumDose.trim() || !calcium.calciumRoute.trim())) throw new Error("MTP_CALCIUM_CONFIGURATION_INVALID");
  if (delivery && (![delivery.gravityDurationSec, delivery.pressureBagDurationSec, delivery.rapidInfuserDurationSec].every(value => Number.isFinite(value) && value > 0) ||
    !Number.isInteger(delivery.rapidInfuserBagCapacity) || delivery.rapidInfuserBagCapacity <= 0 || !Number.isInteger(delivery.initialVascularAccessCount) ||
    delivery.initialVascularAccessCount < 0 || delivery.initialVascularAccessCount > 3)) throw new Error("MTP_DELIVERY_CONFIGURATION_INVALID");
  const lineIds = (["IV-1", "IV-2", "IV-3"] as VascularAccessLineId[]).slice(0, delivery?.initialVascularAccessCount ?? 0);
  const base: Omit<MassiveTransfusionPatientProcessRuntime, "outputs"> = {
    processId: String(initial.processId ?? `${encounterId}:MASSIVE_TRANSFUSION`), encounterId,
    instanceKey: String(initial.instanceKey ?? `${encounterId}:massive-transfusion`), processType: "MASSIVE_TRANSFUSION",
    templateId: String(initial.templateId ?? "MTP_REFERENCE_V1"), state: "Active", elapsedTime: 0, nextTick: 60, configuration,
    clinicalState: { activated: false, inventory: { ...configuration.initialInventory }, administeredUnits: { RBC: 0, PLASMA: 0, PLATELETS: 0 },
      transfusedVolumeMl: 0, oxygenCarryingCapacity: 0, coagulationSupport: 0, administrations: [],
      completedRbcUnitsTotal: 0, completedRbcUnitsSinceLastCalcium: 0,
      rbcUnitsPerCalcium: calcium?.calciumEnabled ? calcium.rbcUnitsPerCalcium : null,
      calciumRecommended: false, calciumAdministrations: [], calciumLastAdministeredAt: null,
      calciumAdministrationCount: 0, vascularAccessCount: lineIds.length,
      vascularAccessLines: lineIds.map(lineId => ({ lineId, status: "FREE" as const })), processedCommandIds: [] }, pendingEvidence: [],
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

const durationForMode = (configuration: MassiveTransfusionConfiguration, mode: BloodProductDeliveryMode): number | undefined => {
  const delivery = configuration.bloodProductDelivery;
  return delivery && ({ GRAVITY: delivery.gravityDurationSec, PRESSURE_BAG: delivery.pressureBagDurationSec,
    RAPID_INFUSER: delivery.rapidInfuserDurationSec } as const)[mode];
};

export function setMtpVascularAccessCount(previous: MassiveTransfusionPatientProcessRuntime, count: number): MassiveTransfusionPatientProcessRuntime {
  if (!Number.isInteger(count) || count < 0 || count > 3) throw new Error("INVALID_VASCULAR_ACCESS_COUNT");
  const occupied = previous.clinicalState.vascularAccessLines.filter(line => line.status === "OCCUPIED");
  if (occupied.some(line => Number(line.lineId.slice(3)) > count)) throw new Error("VASCULAR_ACCESS_OCCUPIED");
  const base = structuredClone(previous); const ids = (["IV-1", "IV-2", "IV-3"] as VascularAccessLineId[]).slice(0, count);
  base.clinicalState.vascularAccessCount = count;
  base.clinicalState.vascularAccessLines = ids.map(lineId => occupied.find(line => line.lineId === lineId) ?? { lineId, status: "FREE" as const });
  const { outputs: _outputs, ...without } = base; return withOutput(without);
}

export function startBloodProductAdministration(previous: MassiveTransfusionPatientProcessRuntime, commandId: string, product: BloodProductType, units: number,
  deliveryMode: BloodProductDeliveryMode = "GRAVITY", requestedLineId?: VascularAccessLineId): MassiveTransfusionPatientProcessRuntime {
  if (previous.clinicalState.processedCommandIds.includes(commandId)) return structuredClone(previous);
  if (!previous.clinicalState.activated) throw new Error("MTP_NOT_ACTIVATED");
  if (!Number.isInteger(units) || units <= 0) throw new Error("INVALID_BLOOD_PRODUCT_QUANTITY");
  if (previous.clinicalState.inventory[product] < units) throw new Error("BLOOD_PRODUCT_UNAVAILABLE");
  const delivery = previous.configuration.bloodProductDelivery;
  if (delivery && units !== 1) throw new Error("ONE_BAG_PER_ADMINISTRATION_REQUIRED");
  const durationSec = durationForMode(previous.configuration, deliveryMode);
  let assignedLineId: VascularAccessLineId | undefined;
  if (delivery) {
    const line = requestedLineId
      ? previous.clinicalState.vascularAccessLines.find(candidate => candidate.lineId === requestedLineId)
      : previous.clinicalState.vascularAccessLines.find(candidate => candidate.status === "FREE");
    if (!line || line.status !== "FREE") throw new Error("NO_FREE_VASCULAR_ACCESS");
    if (deliveryMode === "RAPID_INFUSER" && previous.clinicalState.administrations.filter(item => item.state === "RUNNING" && item.deliveryMode === "RAPID_INFUSER").length >= delivery.rapidInfuserBagCapacity)
      throw new Error("DELIVERY_DEVICE_CAPACITY_FULL");
    assignedLineId = line.lineId;
  }
  const base = structuredClone(previous); const definition = base.configuration.products[product];
  base.clinicalState.inventory[product] -= units; base.clinicalState.processedCommandIds.push(commandId); base.clinicalState.processedCommandIds.sort();
  base.clinicalState.administrations.push({ administrationId: commandId, product, units, totalVolumeMl: definition.volumeMlPerUnit * units,
    deliveredVolumeMl: 0, deliveredUnits: 0, state: "RUNNING", ...(delivery ? { deliveryMode, vascularAccessLineId: assignedLineId,
      startedAtSec: base.elapsedTime, expectedCompletionAtSec: base.elapsedTime + durationSec!, durationSec } : {}) });
  if (assignedLineId) base.clinicalState.vascularAccessLines = base.clinicalState.vascularAccessLines.map(line =>
    line.lineId === assignedLineId ? { ...line, status: "OCCUPIED" as const, administrationId: commandId } : line);
  base.clinicalState.administrations.sort((a, b) => a.administrationId.localeCompare(b.administrationId));
  base.pendingEvidence.push({ eventType: "BLOOD_PRODUCT_ADMINISTRATION_STARTED", details: { commandId, product, units,
    ...(delivery ? { deliveryMode, vascularAccessLineId: assignedLineId, durationSec, expectedCompletionAtSec: base.elapsedTime + durationSec! } : {}) } });
  const { outputs: _outputs, ...without } = base; return withOutput(without);
}

export function tickMassiveTransfusionPatientProcess(previous: MassiveTransfusionPatientProcessRuntime, seconds: number): MassiveTransfusionPatientProcessRuntime {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("INVALID_TICK_DURATION");
  const base = structuredClone(previous); const evidence: MassiveTransfusionEvidence[] = [];
  base.clinicalState.administrations = base.clinicalState.administrations.map(item => {
    if (item.state === "COMPLETED") return item;
    const definition = base.configuration.products[item.product];
    const rateMlMin = item.durationSec ? item.totalVolumeMl / (item.durationSec / 60) : definition.administrationRateMlMin;
    const deliveredVolumeMl = Math.min(item.totalVolumeMl, precise(item.deliveredVolumeMl + rateMlMin * seconds / 60));
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
      if (item.vascularAccessLineId) base.clinicalState.vascularAccessLines = base.clinicalState.vascularAccessLines.map(line =>
        line.lineId === item.vascularAccessLineId && line.administrationId === item.administrationId ? { lineId: line.lineId, status: "FREE" as const } : line);
      evidence.push({ eventType: "BLOOD_PRODUCT_ADMINISTRATION_COMPLETED", details: { commandId: item.administrationId, product: item.product, units: item.units,
        ...(item.deliveryMode ? { deliveryMode: item.deliveryMode, vascularAccessLineId: item.vascularAccessLineId, completedAtSec: base.elapsedTime + seconds } : {}) } }); }
    return { ...item, deliveredVolumeMl, deliveredUnits, state };
  });
  base.elapsedTime = precise(base.elapsedTime + seconds); base.nextTick = precise(base.nextTick + seconds); base.pendingEvidence.push(...evidence);
  const { outputs: _outputs, ...without } = base; return withOutput(without);
}

export function terminateBloodProductAdministration(previous: MassiveTransfusionPatientProcessRuntime, administrationId: string,
  terminalState: "CANCELLED" | "FAILED"): MassiveTransfusionPatientProcessRuntime {
  const base = structuredClone(previous); const administration = base.clinicalState.administrations.find(item => item.administrationId === administrationId);
  if (!administration || administration.state !== "RUNNING") return base;
  base.clinicalState.administrations = base.clinicalState.administrations.map(item => item.administrationId === administrationId ? { ...item, state: terminalState } : item);
  if (administration.vascularAccessLineId) base.clinicalState.vascularAccessLines = base.clinicalState.vascularAccessLines.map(line =>
    line.lineId === administration.vascularAccessLineId && line.administrationId === administrationId ? { lineId: line.lineId, status: "FREE" as const } : line);
  const { outputs: _outputs, ...without } = base; return withOutput(without);
}

export function drainMassiveTransfusionEvidence(previous: MassiveTransfusionPatientProcessRuntime): { process: MassiveTransfusionPatientProcessRuntime; evidence: MassiveTransfusionEvidence[] } {
  const evidence = structuredClone(previous.pendingEvidence); const base = structuredClone(previous); base.pendingEvidence = [];
  return { process: base, evidence };
}
