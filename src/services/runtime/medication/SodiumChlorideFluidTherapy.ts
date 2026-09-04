import {
  SODIUM_CHLORIDE_0_9_FEATURE_ID,
  type FluidTherapyConfiguration,
  type FluidTherapyProductDefinition,
} from "@/models/FluidTherapy";
import { createFluidTherapyContract, FluidTherapyRuntime } from "./FluidTherapyRuntime";
import { RINGER_FLUID_CONFIGURATION } from "./RingerFluidTherapy";

export const SODIUM_CHLORIDE_0_9_CONFIGURATION:
FluidTherapyConfiguration<typeof SODIUM_CHLORIDE_0_9_FEATURE_ID> = Object.freeze({
  ...RINGER_FLUID_CONFIGURATION,
  version: "SODIUM_CHLORIDE_0_9_VOLUME_V1",
  fluidType: SODIUM_CHLORIDE_0_9_FEATURE_ID,
});

export const SODIUM_CHLORIDE_0_9_PRODUCT: FluidTherapyProductDefinition<
  typeof SODIUM_CHLORIDE_0_9_FEATURE_ID
> = Object.freeze({
  fluidClass: "CRYSTALLOID",
  configuration: SODIUM_CHLORIDE_0_9_CONFIGURATION,
});

export const sodiumChlorideClinicalFeatureContract = createFluidTherapyContract(
  SODIUM_CHLORIDE_0_9_PRODUCT.configuration,
  SODIUM_CHLORIDE_0_9_PRODUCT.fluidClass,
);

export class SodiumChlorideFluidTherapyRuntime extends FluidTherapyRuntime<
  typeof SODIUM_CHLORIDE_0_9_FEATURE_ID
> {
  constructor() {
    super(SODIUM_CHLORIDE_0_9_PRODUCT.configuration, SODIUM_CHLORIDE_0_9_PRODUCT.fluidClass);
  }
}
