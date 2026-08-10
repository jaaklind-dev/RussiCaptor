import { ProtocolConfigurationRegistry } from "./ProtocolConfigurationRegistry";
import { protocolConfigurationRegistrySeed } from "./ReferenceProtocolConfigurations";

export const protocolConfigurationRegistry = new ProtocolConfigurationRegistry();
protocolConfigurationRegistrySeed.forEach(protocol => protocolConfigurationRegistry.register(protocol));
