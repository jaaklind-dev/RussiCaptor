import type { AggregationInput, AggregationResult } from "@/models/RuntimeAggregation";
import { RuntimeOwnershipResolver } from "@/services/runtime/OwnershipResolver";
import { aggregateResolvedRuntimeState, prepareProcessOutputs } from "@/services/runtime/RuntimeAggregationPipeline";
import { resolveVitalSignRuntime } from "@/services/runtime/vitals/VitalSignRuntimeResolver";

/** Frozen order: PatientProcess outputs -> VitalSignEngine -> Aggregation -> Snapshot. */
export function aggregateRuntimeState(input: AggregationInput, resolver: RuntimeOwnershipResolver): AggregationResult {
  const acceptedOutputs = prepareProcessOutputs(input);
  const vitalResolution = resolveVitalSignRuntime(input.previous, acceptedOutputs, input.overrides, input.exerciseTimeSec);
  return aggregateResolvedRuntimeState(input, resolver, vitalResolution);
}
