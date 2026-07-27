import type { OwnershipRule } from "@/models/ModuleImport";
import { RuntimeOwnershipResolver } from "@/services/runtime/OwnershipResolver";

const rules: OwnershipRule[] = [
  {
    objectType: "RuntimeField",
    objectOrField: "globalStatus",
    canonicalOwner: "CORE_ENGINE",
    contributionAllowedFrom: "All active processes",
    aggregationOrWriteRule: "MOST_SEVERE valid status proposal.",
    conflictAction: "REJECT_DIRECT_OVERRIDE",
  },
  {
    objectType: "RuntimeField",
    objectOrField: "mentalStatusCode",
    canonicalOwner: "CORE_ENGINE",
    contributionAllowedFrom: "HYPOVENTILATION_HYPERCAPNIA_V1; HYPOXIA_V1; sedation/other modules",
    aggregationOrWriteRule: "MOST_SEVERE attributable limitation.",
    conflictAction: "REJECT_UNATTRIBUTED_CHANGE",
  },
  {
    objectType: "RuntimeField",
    objectOrField: "SpO2 / oxygenationReserve",
    canonicalOwner: "HYPOXIA_V1",
    contributionAllowedFrom: "Other modules through child-process triggers only",
    aggregationOrWriteRule: "Only Hypoxia writes oxygenation state.",
    conflictAction: "REJECT_DIRECT_OVERRIDE",
  },
  {
    objectType: "RuntimeField",
    objectOrField: "ventilationReserve / co2Burden",
    canonicalOwner: "HYPOVENTILATION_HYPERCAPNIA_V1",
    contributionAllowedFrom: "BOTULISM_V1 through HV child activation",
    aggregationOrWriteRule: "Only HV writes hidden ventilation state.",
    conflictAction: "REJECT_DIRECT_OVERRIDE",
  },
  {
    objectType: "RuntimeField",
    objectOrField: "PaCO2 / pH / EtCO2 target",
    canonicalOwner: "HYPOVENTILATION_HYPERCAPNIA_V1",
    contributionAllowedFrom: "Observation events may record measured values",
    aggregationOrWriteRule: "HV owns generated targets; observations retain source attribution.",
    conflictAction: "REJECT_CONFLICTING_OWNER",
  },
];

function request(overrides: Partial<Parameters<RuntimeOwnershipResolver["authorize"]>[0]> = {}) {
  return {
    objectType: "RuntimeField",
    field: "globalStatus",
    writerId: "CORE_ENGINE",
    writerKind: "MODULE" as const,
    channel: "DIRECT_WRITE" as const,
    attributed: true,
    active: true,
    ...overrides,
  };
}

describe("3B-1 runtime ownership resolver", () => {
  const resolver = new RuntimeOwnershipResolver(rules);

  test("returns all four ownership contract values for field aliases", () => {
    expect(resolver.resolve("RuntimeField", "oxygenationReserve")).toMatchObject({
      canonicalOwner: "HYPOXIA_V1",
      contributionAllowedFrom: "Other modules through child-process triggers only",
      aggregationOrWriteRule: "Only Hypoxia writes oxygenation state.",
      conflictAction: "REJECT_DIRECT_OVERRIDE",
    });
  });

  test("allows the canonical owner to write directly", () => {
    expect(resolver.authorize(request()).mode).toBe("OWNER_WRITE");
    expect(resolver.authorize(request({
      field: "SpO2",
      writerId: "HYPOXIA_V1",
    })).accepted).toBe(true);
  });

  test("rejects a non-owner direct write with the configured conflict action", () => {
    expect(resolver.authorize(request({
      field: "SpO2",
      writerId: "BOTULISM_V1",
    }))).toMatchObject({
      accepted: false,
      mode: "REJECTED",
      conflictAction: "REJECT_DIRECT_OVERRIDE",
    });
  });

  test("allows only attributed child-process contribution to oxygenation", () => {
    expect(resolver.authorize(request({
      field: "SpO2",
      writerId: "BOTULISM_V1",
      channel: "CHILD_PROCESS_TRIGGER",
      attributed: true,
    })).mode).toBe("CONTRIBUTION");
    expect(resolver.authorize(request({
      field: "SpO2",
      writerId: "BOTULISM_V1",
      channel: "PROCESS_CONTRIBUTION",
    })).accepted).toBe(false);
  });

  test("allows named contributors and rejects unattributed mental-state changes", () => {
    expect(resolver.authorize(request({
      field: "mentalStatusCode",
      writerId: "HYPOXIA_V1",
      channel: "PROCESS_CONTRIBUTION",
      attributed: true,
    })).accepted).toBe(true);
    expect(resolver.authorize(request({
      field: "mentalStatusCode",
      writerId: "HYPOXIA_V1",
      channel: "PROCESS_CONTRIBUTION",
      attributed: false,
    }))).toMatchObject({
      accepted: false,
      conflictAction: "REJECT_UNATTRIBUTED_CHANGE",
    });
  });

  test("allows active process proposals and observation events through their channels", () => {
    expect(resolver.authorize(request({
      writerId: "PP-HV-1",
      writerKind: "PROCESS",
      channel: "PROCESS_CONTRIBUTION",
    })).accepted).toBe(true);
    expect(resolver.authorize(request({
      field: "PaCO2",
      writerId: "EV-ABG-1",
      writerKind: "OBSERVATION_EVENT",
      channel: "OBSERVATION_EVENT",
    })).accepted).toBe(true);
  });

  test("fails closed for unknown fields and incomplete rules", () => {
    expect(() => resolver.resolve("RuntimeField", "unknown")).toThrow("ownership-reegel puudub");
    expect(() => new RuntimeOwnershipResolver([{ ...rules[0], conflictAction: "" }]))
      .toThrow("mittetäielikku reeglit");
  });

  test("covers inactive, module, process and core-service contributor policies", () => {
    const broad = new RuntimeOwnershipResolver([{
      objectType: "RuntimeField", objectOrField: "fieldA / fieldB", canonicalOwner: "OWNER_V1",
      contributionAllowedFrom: "All active modules; other processes; CORE_ENGINE",
      aggregationOrWriteRule: "LATEST", conflictAction: "REJECT",
    }]);
    expect(broad.authorize(request({ field: "fieldA", writerId: "MODULE_V1", active: false })).accepted).toBe(false);
    expect(broad.authorize(request({ field: "fieldA", writerId: "MODULE_V1", channel: "PROCESS_CONTRIBUTION" })).accepted).toBe(true);
    expect(broad.authorize(request({ field: "fieldB", writerId: "PP-1", writerKind: "PROCESS", channel: "PROCESS_CONTRIBUTION" })).accepted).toBe(true);
    expect(broad.authorize(request({ field: "fieldB", writerId: "CORE_ENGINE", writerKind: "CORE_SERVICE", channel: "CORE_SERVICE" })).accepted).toBe(true);
  });

  test("rejects duplicate aliases", () => {
    expect(() => new RuntimeOwnershipResolver([rules[0], { ...rules[0] }]))
      .toThrow("ownership-reegel esineb mitu korda");
  });
});
