import type { ClinicalProtocolConfiguration, ProtocolReference } from "@/models/protocol/ClinicalProtocolConfiguration";
import { ProtocolConfigurationValidator } from "./ProtocolConfigurationValidator";

const key = (value: ProtocolReference) => `${value.protocolId}@${value.version}`;
export class ProtocolConfigurationRegistry {
  private readonly values = new Map<string, ClinicalProtocolConfiguration>();
  constructor(private readonly validator = new ProtocolConfigurationValidator()) {}
  register(protocol: ClinicalProtocolConfiguration): ClinicalProtocolConfiguration {
    this.validator.assertValid(protocol); const identity = key(protocol);
    if (this.values.has(identity)) throw new Error(`DUPLICATE_PROTOCOL_CONFIGURATION:${identity}`);
    this.values.set(identity, protocol); return protocol;
  }
  get(reference: ProtocolReference): ClinicalProtocolConfiguration | undefined { return this.values.get(key(reference)); }
  require(reference: ProtocolReference): ClinicalProtocolConfiguration { const value = this.get(reference); if (!value) throw new Error(`UNKNOWN_PROTOCOL_CONFIGURATION:${key(reference)}`); return value; }
  list(): readonly ClinicalProtocolConfiguration[] { return Object.freeze([...this.values.values()].sort((a, b) => a.protocolId.localeCompare(b.protocolId) || a.version.localeCompare(b.version))); }
}
