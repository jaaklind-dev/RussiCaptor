import type { ExerciseDefinition } from "@/models/exercise/ExerciseDefinition";
import type { ProtocolProvenance, ProtocolReference } from "@/models/protocol/ClinicalProtocolConfiguration";
import { ALS_CAPABILITY_STATUS } from "@/modules/als/AlsCapabilityStatus";
import { deepFreeze } from "@/utils/immutable";
import type { ProtocolConfigurationRegistry } from "./ProtocolConfigurationRegistry";

export type ProtocolCompositionDiagnosticCode = "UNKNOWN_PROTOCOL" | "MISSING_PROTOCOL_CAPABILITY";
export type ProtocolCompositionDiagnostic = Readonly<{ code: ProtocolCompositionDiagnosticCode; path: string; message: string }>;
export type ProtocolCompositionResult = Readonly<{ ok: true; definition: ExerciseDefinition; provenance: ProtocolProvenance } | { ok: false; diagnostics: readonly ProtocolCompositionDiagnostic[] }>;

export class ProtocolCompositionService {
  constructor(private readonly registry: ProtocolConfigurationRegistry) {}
  compose(definition: ExerciseDefinition, reference: ProtocolReference, packageId: string): ProtocolCompositionResult {
    const protocol = this.registry.get(reference);
    if (!protocol) return Object.freeze({ ok: false, diagnostics: Object.freeze([{ code: "UNKNOWN_PROTOCOL" as const, path: "protocolConfiguration", message: `Unknown protocol ${reference.protocolId}@${reference.version}` }]) });
    const modules = new Set(definition.clinicalModuleComposition?.modules.map(module => module.moduleId) ?? []);
    const registered = new Set(definition.clinicalModuleComposition?.registrations.capabilities ?? []);
    const resolvedCapabilities = ALS_CAPABILITY_STATUS.filter(item => item.status === "AVAILABLE" && (item.sourceModuleId === "CORE_RUNTIME" || modules.has(item.sourceModuleId ?? "")))
      .map(item => item.capabilityId).concat([...registered]).filter((value, index, values) => values.indexOf(value) === index).sort();
    const missing = protocol.requiredCapabilities.filter(value => !resolvedCapabilities.includes(value));
    if (missing.length) return Object.freeze({ ok: false, diagnostics: Object.freeze(missing.sort().map(value => Object.freeze({ code: "MISSING_PROTOCOL_CAPABILITY" as const, path: "protocolConfiguration.requiredCapabilities", message: `Missing canonical capability ${value}` }))) });
    const provenance: ProtocolProvenance = deepFreeze({ protocolId: protocol.protocolId, version: protocol.version,
      protocolHash: protocol.protocolHash, name: protocol.name, status: protocol.status, authority: protocol.authority,
      ...(protocol.publicationReference ? { publicationReference: protocol.publicationReference } : {}), packageId,
      requiredCapabilities: [...protocol.requiredCapabilities], resolvedCapabilities });
    return deepFreeze({ ok: true, definition: { ...structuredClone(definition), protocolProvenance: provenance }, provenance });
  }
}
