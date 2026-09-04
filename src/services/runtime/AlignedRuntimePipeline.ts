import type { AggregationInput, AggregationResult } from "@/models/RuntimeAggregation";
import { RuntimeOwnershipResolver } from "@/services/runtime/OwnershipResolver";
import { aggregateResolvedRuntimeState, prepareProcessOutputs } from "@/services/runtime/RuntimeAggregationCore";
import { resolveVitalSignRuntime } from "@/services/runtime/vitals/VitalSignRuntimeResolver";
import type { VitalSignContributor } from "@/models/VitalSign";

/** Frozen order: PatientProcess outputs -> VitalSignEngine -> Aggregation -> Snapshot. */
export function aggregateRuntimeState(input: AggregationInput, resolver: RuntimeOwnershipResolver,
  clinicalContributors: readonly VitalSignContributor[] = []): AggregationResult {
  const acceptedOutputs = prepareProcessOutputs(input);
  const vitalResolution = resolveVitalSignRuntime(input.previous, acceptedOutputs, input.overrides,
    input.exerciseTimeSec, clinicalContributors);
  return aggregateResolvedRuntimeState(input, resolver, vitalResolution);
}
