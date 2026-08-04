import type { AnalyticsMetricProvider, MetricDefinition } from "@/models/analytics/Analytics";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export class AnalyticsRegistryError extends Error { constructor(readonly code: "DUPLICATE_PROVIDER_ID" | "DUPLICATE_METRIC_ID" | "INVALID_PROVIDER", message: string) { super(message); } }
export class AnalyticsProviderRegistry {
  readonly providers: readonly AnalyticsMetricProvider[];
  readonly definitions: readonly MetricDefinition[];
  readonly version: string;
  constructor(providers: readonly AnalyticsMetricProvider[]) {
    const providerIds = new Set<string>(); const metricIds = new Set<string>(); const definitions: MetricDefinition[] = [];
    for (const provider of providers) {
      if (!provider.providerId?.trim() || !provider.version?.trim()) throw new AnalyticsRegistryError("INVALID_PROVIDER", "Provider ID and version are required");
      if (providerIds.has(provider.providerId)) throw new AnalyticsRegistryError("DUPLICATE_PROVIDER_ID", `Duplicate provider ${provider.providerId}`); providerIds.add(provider.providerId);
      for (const definition of provider.getDefinitions()) {
        if (!definition.metricId?.trim() || !definition.version?.trim() || definition.providerId !== provider.providerId) throw new AnalyticsRegistryError("INVALID_PROVIDER", `Invalid definition in ${provider.providerId}`);
        if (metricIds.has(definition.metricId)) throw new AnalyticsRegistryError("DUPLICATE_METRIC_ID", `Duplicate metric ${definition.metricId}`); metricIds.add(definition.metricId); definitions.push(Object.freeze({ ...structuredClone(definition), tags: definition.tags ? Object.freeze([...definition.tags]) : undefined }));
      }
    }
    this.providers = Object.freeze([...providers].sort((a, b) => compare(a.providerId, b.providerId) || compare(a.version, b.version)));
    this.definitions = Object.freeze(definitions.sort((a, b) => compare(a.providerId, b.providerId) || compare(a.metricId, b.metricId)));
    this.version = sha256Text(stableJson(this.providers.map(provider => ({ providerId: provider.providerId, version: provider.version })))).slice(0, 16);
    Object.freeze(this);
  }
}
