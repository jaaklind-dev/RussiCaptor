// Compatibility facade. Runtime implementation dependencies remain one-way:
// AlignedRuntimePipeline -> RuntimeAggregationCore.
export { aggregateRuntimeState } from "@/services/runtime/AlignedRuntimePipeline";
export { aggregateResolvedRuntimeState, commitAggregationResult, prepareProcessOutputs } from "@/services/runtime/RuntimeAggregationCore";
