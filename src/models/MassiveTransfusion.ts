import type { ProcessOutput } from "@/models/RuntimeAggregation";
import type { VascularAccessType } from "@/models/CirculationState";

export type BloodProductType = "RBC" | "PLASMA" | "PLATELETS";
export type BloodProductDeliveryMode = "GRAVITY" | "PRESSURE_BAG" | "RAPID_INFUSER";
export type VascularAccessLineId = "IV-1" | "IV-2" | "IV-3";
export type BloodProductDefinition = Readonly<{
  volumeMlPerUnit: number;
  oxygenCapacityPerUnit: number;
  coagulationContributionPerUnit: number;
  administrationRateMlMin: number;
}>;
export type MassiveTransfusionConfiguration = Readonly<{
  version: string;
  products: Readonly<Record<BloodProductType, BloodProductDefinition>>;
  initialInventory: Readonly<Record<BloodProductType, number>>;
  vitalResponsePer1000Ml: Readonly<{ heartRateDelta: number; systolicBpDelta: number; diastolicBpDelta: number; crtDelta: number }>;
  calciumReplacement?: Readonly<{
    calciumEnabled: boolean;
    rbcUnitsPerCalcium: number;
    calciumProduct: string;
    calciumDose: string;
    calciumRoute: string;
  }>;
  bloodProductDelivery?: Readonly<{
    gravityDurationSec: number;
    pressureBagDurationSec: number;
    rapidInfuserDurationSec: number;
    rapidInfuserBagCapacity: number;
  }>;
}>;
export type BloodProductAdministration = Readonly<{
  administrationId: string;
  product: BloodProductType;
  units: number;
  totalVolumeMl: number;
  deliveredVolumeMl: number;
  deliveredUnits: number;
  state: "RUNNING" | "COMPLETED" | "CANCELLED" | "FAILED";
  deliveryMode?: BloodProductDeliveryMode;
  vascularAccessLineId?: VascularAccessLineId;
  startedAtSec?: number;
  expectedCompletionAtSec?: number;
  durationSec?: number;
}>;
export type MassiveTransfusionEvidence = Readonly<{
  eventType: "MTP_ACTIVATED" | "BLOOD_PRODUCT_ADMINISTRATION_STARTED" | "BLOOD_PRODUCT_ADMINISTRATION_COMPLETED" | "MTP_CALCIUM_DUE" | "MTP_CALCIUM_ADMINISTERED";
  details: Readonly<Record<string, unknown>>;
}>;
export type TransfusionCalciumSupportState = {
  completedRbcUnitsTotal: number;
  completedRbcUnitsSinceLastCalcium: number;
  rbcUnitsPerCalcium: number | null;
  calciumRecommended: boolean;
  calciumAdministrations: Readonly<{ administrationId: string; product: string; dose: string; route: string; completedAtSec: number }>[];
  calciumLastAdministeredAt: number | null;
  calciumAdministrationCount: number;
};
export type MassiveTransfusionPatientProcessRuntime = {
  processId: string; encounterId: string; instanceKey: string; processType: "MASSIVE_TRANSFUSION";
  templateId: string; state: "Active" | "Controlled" | "Resolved"; elapsedTime: number; nextTick: number;
  configuration: MassiveTransfusionConfiguration;
  clinicalState: {
    activated: boolean;
    activationId?: string;
    inventory: Record<BloodProductType, number>;
    administeredUnits: Record<BloodProductType, number>;
    transfusedVolumeMl: number;
    oxygenCarryingCapacity: number;
    coagulationSupport: number;
    administrations: BloodProductAdministration[];
    transfusionCalcium: TransfusionCalciumSupportState;
    vascularAccessCount: number;
    vascularAccessLines: Readonly<{ lineId: VascularAccessLineId; status: "MISSING" | "FREE" | "OCCUPIED";
      accessInterventionInstanceId?: string; accessType?: VascularAccessType; administrationId?: string }>[];
    processedCommandIds: string[];
  };
  pendingEvidence: MassiveTransfusionEvidence[];
  outputs: ProcessOutput;
};

export const MTP_REFERENCE_CONFIGURATION: MassiveTransfusionConfiguration = Object.freeze({
  version: "1.0.0",
  products: Object.freeze({
    RBC: Object.freeze({ volumeMlPerUnit: 300, oxygenCapacityPerUnit: 1, coagulationContributionPerUnit: 0, administrationRateMlMin: 100 }),
    PLASMA: Object.freeze({ volumeMlPerUnit: 250, oxygenCapacityPerUnit: 0, coagulationContributionPerUnit: 1, administrationRateMlMin: 100 }),
    PLATELETS: Object.freeze({ volumeMlPerUnit: 300, oxygenCapacityPerUnit: 0, coagulationContributionPerUnit: 1, administrationRateMlMin: 100 }),
  }),
  initialInventory: Object.freeze({ RBC: 6, PLASMA: 6, PLATELETS: 1 }),
  vitalResponsePer1000Ml: Object.freeze({ heartRateDelta: -12, systolicBpDelta: 14, diastolicBpDelta: 8, crtDelta: -0.7 }),
  calciumReplacement: Object.freeze({ calciumEnabled: true, rbcUnitsPerCalcium: 3, calciumProduct: "Kaltsiumkloriid",
    calciumDose: "1 g", calciumRoute: "IV" }),
});

export const WP47C_DEFAULT_DELIVERY_CONFIGURATION = Object.freeze({
  gravityDurationSec: 720,
  pressureBagDurationSec: 480,
  rapidInfuserDurationSec: 180,
  rapidInfuserBagCapacity: 2,
});
