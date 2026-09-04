import {
  RINGER_FEATURE_ID,
  type FluidTherapyConfiguration,
  type FluidTherapyProductDefinition,
} from "@/models/FluidTherapy";
import { createFluidTherapyContract, FluidTherapyRuntime } from "./FluidTherapyRuntime";

export const RINGER_FLUID_CONFIGURATION: FluidTherapyConfiguration<typeof RINGER_FEATURE_ID> = Object.freeze({
  schemaVersion: 1,
  version: "RINGER_VOLUME_V1",
  fluidType: RINGER_FEATURE_ID,
  effectiveIntravascularFraction: 0.25,
  maximumPrescribedVolumeMl: 5000,
  maximumRateMlHour: 3000,
  vitalResponsePer1000EffectiveMl: Object.freeze({
    heartRateDelta: -35,
    systolicBpDelta: 35,
    diastolicBpDelta: 20,
    crtDelta: -2,
  }),
});

export const RINGER_FLUID_PRODUCT: FluidTherapyProductDefinition<typeof RINGER_FEATURE_ID> = Object.freeze({
  fluidClass: "CRYSTALLOID",
  configuration: RINGER_FLUID_CONFIGURATION,
});

export const ringerClinicalFeatureContract = createFluidTherapyContract(
  RINGER_FLUID_PRODUCT.configuration,
  RINGER_FLUID_PRODUCT.fluidClass,
);

export class RingerFluidTherapyRuntime extends FluidTherapyRuntime<typeof RINGER_FEATURE_ID> {
  constructor() {
    super(RINGER_FLUID_PRODUCT.configuration, RINGER_FLUID_PRODUCT.fluidClass);
  }
}
