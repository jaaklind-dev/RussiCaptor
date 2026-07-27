import type { OwnershipRule } from "@/models/ModuleImport";
import type { ProcessOutput, RuntimeState } from "@/models/RuntimeAggregation";
import { RuntimeOwnershipResolver } from "@/services/runtime/OwnershipResolver";
import {
  aggregateRuntimeState,
  commitAggregationResult,
} from "@/services/runtime/RuntimeAggregationPipeline";

const ownershipRules: OwnershipRule[] = [
  {
    objectType: "RuntimeField",
    objectOrField: "globalStatus",
    canonicalOwner: "CORE_ENGINE",
    contributionAllowedFrom: "All active processes",
    aggregationOrWriteRule: "MOST_SEVERE",
    conflictAction: "REJECT_DIRECT_OVERRIDE",
  },
  {
    objectType: "RuntimeField",
    objectOrField: "mentalStatusCode",
    canonicalOwner: "CORE_ENGINE",
    contributionAllowedFrom: "HYPOXIA_V1; HYPOVENTILATION_HYPERCAPNIA_V1; BOTULISM_V1",
    aggregationOrWriteRule: "MOST_SEVERE",
    conflictAction: "REJECT_UNATTRIBUTED_CHANGE",
  },
  {
    objectType: "RuntimeField",
    objectOrField: "coughStrength",
    canonicalOwner: "BOTULISM_V1",
    contributionAllowedFrom: "HYPOVENTILATION_HYPERCAPNIA_V1",
    aggregationOrWriteRule: "LATEST attributable value",
    conflictAction: "REJECT_CONFLICTING_OWNER",
  },
  {
    objectType: "RuntimeField",
    objectOrField: "symptomEvidence",
    canonicalOwner: "CORE_ENGINE",
    contributionAllowedFrom: "All active processes",
    aggregationOrWriteRule: "UNION",
    conflictAction: "MERGE_ATTRIBUTED_VALUES",
  },
];

const resolver = new RuntimeOwnershipResolver(ownershipRules);

function state(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    encounterId: "ENC-1",
    stateVersion: 4,
    exerciseTimeSec: 0,
    globalStatus: "Stable",
    targetVitals: { hr: 80, sbp: 120, dbp: 75, rr: 16, spo2: 98, temperature: 36.8, crt: 2 },
    displayedVitals: { hr: 80, sbp: 120, dbp: 75, rr: 16, spo2: 98, temperature: 36.8, crt: 2 },
    mentalStatusCode: "Alert",
    symptomTags: [],
    visibleFindings: [],
    activeAlerts: [],
    runtimeFields: {},
    vitalAttribution: {},
    statusAttribution: { supportingProcessIds: [] },
    manualOverrideActive: false,
    overrideMap: {},
    aggregationConfigVersion: "1.0",
    randomSeed: 42,
    ...overrides,
  };
}

function output(overrides: Partial<ProcessOutput> = {}): ProcessOutput {
  return {
    processId: "PP-1",
    encounterId: "ENC-1",
    moduleId: "BOTULISM_V1",
    status: "Active",
    globalSeverityScore: 0.5,
    ...overrides,
  };
}

function aggregate(processOutputs: ProcessOutput[], previous = state(), extras = {}) {
  return aggregateRuntimeState({
    previous,
    expectedStateVersion: previous.stateVersion,
    exerciseTimeSec: 60,
    processOutputs,
    aggregationConfigVersion: "1.1",
    ...extras,
  }, resolver);
}

describe("WP-3B-2 runtime aggregation pipeline", () => {
  test("aggregates clinical targets, applies caps and smooths display values", () => {
    const result = aggregate([
      output({
        processId: "PP-PRIMARY",
        hrTargetRange: { min: 110, max: 130 },
        rrTargetRange: { min: 25, max: 35 },
        sbpTargetRange: { min: 70, max: 80 },
        dbpTargetRange: { min: 40, max: 50 },
        spo2Ceiling: 82,
        temperatureTarget: 39,
        crtTarget: 5,
      }),
      output({ processId: "PP-SUPPORT-1", hrDelta: 30, rrDelta: 10, sbpSupportDelta: 15 }),
      output({ processId: "PP-SUPPORT-2", hrDelta: 30, rrDelta: 10, sbpSupportDelta: 15 }),
    ]);

    expect(result.state.targetVitals).toMatchObject({
      hr: 155,
      sbp: 95,
      dbp: 45,
      rr: 42,
      spo2: 82,
      temperature: 39,
      crt: 5,
    });
    expect(result.state.displayedVitals).toMatchObject({
      hr: 105,
      sbp: 110,
      dbp: 64.5,
      rr: 26,
      spo2: 90.8,
      crt: 3.5,
    });
    expect(result.state.displayedVitals.temperature).toBeCloseTo(37.24, 2);
    expect(result.state.mapCalculated).toBeCloseTo(79.67, 2);
    expect(result.events.filter((event) => event.eventType === "AGGREGATION_CAP_APPLIED"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ field: "hr" }),
        expect.objectContaining({ field: "rr" }),
        expect.objectContaining({ field: "sbp" }),
      ]));
  });

  test("selects the most restrictive oxygen ceiling and most severe mental/status contribution", () => {
    const result = aggregate([
      output({
        processId: "PP-BOT",
        spo2Ceiling: 91,
        mentalStatusCeiling: "Drowsy",
        statusProposal: "Critical",
      }),
      output({
        processId: "PP-HYPOXIA",
        moduleId: "HYPOXIA_V1",
        spo2Ceiling: 84,
        mentalStatusCeiling: "Unresponsive",
        statusProposal: "Arrest",
      }),
    ]);

    expect(result.state.targetVitals.spo2).toBe(84);
    expect(result.state.vitalAttribution.spo2.primaryProcessId).toBe("PP-HYPOXIA");
    expect(result.state.globalStatus).toBe("Arrest");
    expect(result.state.mentalStatusCode).toBe("Arrest");
    expect(result.state.gcsTarget).toBe(3);
  });

  test("unions collections and deduplicates findings by code and location", () => {
    const result = aggregate([
      output({
        processId: "PP-A",
        symptomTags: ["weakness", "dyspnea"],
        alerts: ["AIRWAY"],
        visibleFindings: [{ code: "PTOSIS", location: "bilateral", severity: 1 }],
      }),
      output({
        processId: "PP-B",
        symptomTags: ["weakness"],
        alerts: ["AIRWAY", "ICU"],
        visibleFindings: [{ code: "PTOSIS", location: "bilateral", severity: 3 }],
      }),
    ]);

    expect(result.state.symptomTags).toEqual(["dyspnea", "weakness"]);
    expect(result.state.activeAlerts).toEqual(["AIRWAY", "ICU"]);
    expect(result.state.visibleFindings).toEqual([
      { code: "PTOSIS", location: "bilateral", severity: 3 },
    ]);
  });

  test("uses ownership rules for generic fields and logs rejected writes with a reason", () => {
    const result = aggregate([
      output({
        processId: "PP-OWNER",
        observedAtSec: 10,
        runtimeContributions: { coughStrength: 4, symptomEvidence: ["ptosis"] },
      }),
      output({
        processId: "PP-ALLOWED",
        moduleId: "HYPOVENTILATION_HYPERCAPNIA_V1",
        observedAtSec: 20,
        runtimeContributions: { coughStrength: 2, symptomEvidence: ["weakness"] },
      }),
      output({
        processId: "PP-BLOCKED",
        moduleId: "HYPOXIA_V1",
        observedAtSec: 30,
        runtimeContributions: { coughStrength: 1 },
      }),
    ]);

    expect(result.state.runtimeFields).toEqual({
      coughStrength: 2,
      symptomEvidence: ["ptosis", "weakness"],
    });
    expect(result.events).toContainEqual(expect.objectContaining({
      eventType: "PROCESS_OUTPUT_REJECTED",
      processId: "PP-BLOCKED",
      field: "coughStrength",
      details: expect.objectContaining({
        reason: expect.stringContaining("pole"),
        conflictAction: "REJECT_CONFLICTING_OWNER",
      }),
    }));
    expect(result.events).toContainEqual(expect.objectContaining({
      eventType: "AGGREGATION_CONFLICT_RESOLVED",
      field: "coughStrength",
    }));
  });

  test("is deterministic regardless of process output order", () => {
    const outputs = [
      output({ processId: "PP-B", hrTargetRange: { min: 90, max: 110 }, statusProposal: "Critical" }),
      output({ processId: "PP-A", hrTargetRange: { min: 90, max: 110 }, statusProposal: "Critical" }),
    ];
    expect(aggregate(outputs)).toEqual(aggregate([...outputs].reverse()));
  });

  test("keeps Dead terminal and applies Critical recovery hysteresis", () => {
    expect(aggregate([], state({ globalStatus: "Dead" })).state.globalStatus).toBe("Dead");

    const critical = state({ globalStatus: "Critical" });
    const firstClear = aggregate([], critical, { exerciseTimeSec: 100 });
    expect(firstClear.state.globalStatus).toBe("Critical");
    expect(firstClear.state.criticalClearSinceSec).toBe(100);

    const stillCritical = aggregate([], firstClear.state, { exerciseTimeSec: 219 });
    expect(stillCritical.state.globalStatus).toBe("Critical");
    const recovered = aggregate([], stillCritical.state, { exerciseTimeSec: 220 });
    expect(recovered.state.globalStatus).toBe("Stable");
  });

  test("rejects malformed sources, ignores inactive processes and preserves the audit trail", () => {
    const result = aggregate([
      output({ processId: "WRONG", encounterId: "OTHER", statusProposal: "Dead" }),
      output({ processId: "DONE", status: "Resolved", statusProposal: "Dead" }),
      output({ processId: "BAD-RANGE", hrTargetRange: { min: 130, max: 80 } }),
    ]);

    expect(result.rejectedProcessIds).toEqual(["WRONG"]);
    expect(result.acceptedProcessIds).toEqual(["BAD-RANGE"]);
    expect(result.state.globalStatus).toBe("Stable");
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: "AGGREGATION_STARTED" }),
      expect.objectContaining({ eventType: "PROCESS_OUTPUT_REJECTED", processId: "WRONG" }),
      expect.objectContaining({ eventType: "PROCESS_OUTPUT_REJECTED", processId: "BAD-RANGE", field: "hrTargetRange" }),
      expect.objectContaining({ eventType: "AGGREGATION_COMPLETED" }),
    ]));
  });

  test("applies only authorized overrides", () => {
    const result = aggregate([], state({ runtimeFields: { coughStrength: 3 } }), {
      overrides: [
        { field: "hrTarget", value: 72, authorized: true, actorId: "EXCON", eventId: "EV-1" },
        { field: "mentalStatusCode", value: "Confused", authorized: true, actorId: "EXCON", eventId: "EV-2" },
        { field: "coughStrength", value: 5, authorized: false, actorId: "CM", eventId: "EV-3" },
      ],
    });

    expect(result.state.targetVitals.hr).toBe(72);
    expect(result.state.displayedVitals.hr).toBe(72);
    expect(result.state.mentalStatusCode).toBe("Confused");
    expect(result.state.runtimeFields.coughStrength).toBe(3);
    expect(result.state.manualOverrideActive).toBe(true);
    expect(result.events.filter((event) => event.eventType === "MANUAL_OVERRIDE_APPLIED")).toHaveLength(2);
    expect(result.events.filter((event) => event.eventType === "MANUAL_OVERRIDE_REJECTED")).toHaveLength(1);
  });

  test("guards atomic state versions and delegates a validated result to the committer", async () => {
    const previous = state();
    expect(() => aggregateRuntimeState({
      previous,
      expectedStateVersion: 3,
      exerciseTimeSec: 60,
      processOutputs: [],
      aggregationConfigVersion: "1.1",
    }, resolver)).toThrow("RUNTIME_COMMIT_CONFLICT");

    const result = aggregate([]);
    const commit = jest.fn().mockResolvedValue(undefined);
    await commitAggregationResult(result, 4, { commit });
    expect(commit).toHaveBeenCalledWith(result, 4);
    expect(result.state.stateVersion).toBe(5);
  });
});
