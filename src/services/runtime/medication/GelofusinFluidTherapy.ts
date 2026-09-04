import {
  GELOFUSIN_FEATURE_ID,
  type FluidTherapyConfiguration,
  type FluidTherapyProductDefinition,
} from "@/models/FluidTherapy";
import { createFluidTherapyContract, FluidTherapyRuntime } from "./FluidTherapyRuntime";
import { RINGER_FLUID_CONFIGURATION } from "./RingerFluidTherapy";

export const GELOFUSIN_EFFECTIVE_VOLUME_HALF_LIFE_SEC = 7200;

export const GELOFUSIN_FLUID_CONFIGURATION: FluidTherapyConfiguration<typeof GELOFUSIN_FEATURE_ID> = Object.freeze({
  ...RINGER_FLUID_CONFIGURATION,
  version: "GELOFUSIN_VOLUME_V1",
  fluidType: GELOFUSIN_FEATURE_ID,
  effectiveIntravascularFraction: 1,
  effectiveVolumePersistence: Object.freeze({
    model: "EXPONENTIAL_DECAY",
    halfLifeSec: GELOFUSIN_EFFECTIVE_VOLUME_HALF_LIFE_SEC,
  }),
});

export const GELOFUSIN_FLUID_PRODUCT: FluidTherapyProductDefinition<typeof GELOFUSIN_FEATURE_ID> = Object.freeze({
  fluidClass: "COLLOID",
  configuration: GELOFUSIN_FLUID_CONFIGURATION,
});

export const gelofusinClinicalFeatureContract = createFluidTherapyContract(
  GELOFUSIN_FLUID_PRODUCT.configuration,
  GELOFUSIN_FLUID_PRODUCT.fluidClass,
);

export class GelofusinFluidTherapyRuntime extends FluidTherapyRuntime<typeof GELOFUSIN_FEATURE_ID> {
  constructor() {
    super(GELOFUSIN_FLUID_PRODUCT.configuration, GELOFUSIN_FLUID_PRODUCT.fluidClass);
  }
}
