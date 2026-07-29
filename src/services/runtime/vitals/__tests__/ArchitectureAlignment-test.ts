import type { RuntimeState } from "@/models/RuntimeAggregation";
import { RuntimeOwnershipResolver } from "@/services/runtime/OwnershipResolver";
import { aggregateRuntimeState } from "@/services/runtime/AlignedRuntimePipeline";
import { defaultVitalSignConfiguration, VitalSignEngine } from "@/services/runtime/vitals/VitalSignEngine";
import { projectVitalSignState } from "@/services/runtime/vitals/VitalSignProjection";

function canonicalState(): RuntimeState {
  const vitalSignState = new VitalSignEngine().resolve({ timestamp:0, configuration:defaultVitalSignConfiguration, contributors:[] }).state;
  return {
    encounterId:"PT-AA1", stateVersion:0, exerciseTimeSec:0, globalStatus:"Stable",
    ...projectVitalSignState(vitalSignState), vitalSignState, vitalSignConfiguration:defaultVitalSignConfiguration,
    mentalStatusCode:"Alert", symptomTags:[], visibleFindings:[], activeAlerts:[], runtimeFields:{},
    vitalAttribution:{}, statusAttribution:{supportingProcessIds:[]}, manualOverrideActive:false,
    overrideMap:{}, aggregationConfigVersion:"WP-AA1", randomSeed:1,
  };
}

describe("WP-AA1 architecture alignment", () => {
  test("all compatibility vital fields are read-only projections of canonical VitalSignState", () => {
    const result = aggregateRuntimeState({ previous:canonicalState(), expectedStateVersion:0, exerciseTimeSec:1,
      processOutputs:[], aggregationConfigVersion:"WP-AA1" }, new RuntimeOwnershipResolver([]));
    const projection = projectVitalSignState(result.state.vitalSignState!);
    expect(result.state.targetVitals).toEqual(projection.targetVitals);
    expect(result.state.displayedVitals).toEqual(projection.displayedVitals);
    expect(result.state.mapCalculated).toBe(projection.mapCalculated);
    expect(result.state.gcsTarget).toBe(projection.gcsTarget);
    expect(Object.isFrozen(result.state.targetVitals)).toBe(true);
    expect(Object.isFrozen(result.state.displayedVitals)).toBe(true);
  });

  test("manual override uses the contributor mechanism and updates state, trend, derived values, events and attribution", () => {
    const result = aggregateRuntimeState({ previous:canonicalState(), expectedStateVersion:0, exerciseTimeSec:1,
      processOutputs:[], aggregationConfigVersion:"WP-AA1", overrides:[{
        field:"hrTarget", value:120, authorized:true, actorId:"EXCON-1", eventId:"OVERRIDE-1",
      }] }, new RuntimeOwnershipResolver([]));
    const vital = result.state.vitalSignState!;
    expect(vital.readings.heartRate).toMatchObject({ current:120, target:120, direction:"RISING" });
    expect(result.state.displayedVitals.hr).toBe(120);
    expect(result.state.targetVitals.hr).toBe(120);
    expect(vital.derived.shockIndex).toBe(1);
    expect(result.state.vitalAttribution.hr?.primaryProcessId).toBe("EXCON-1");
    expect(vital.activeContributors).toContainEqual(expect.objectContaining({ sourceType:"MANUAL_OVERRIDE", operation:"OVERRIDE" }));
    expect(result.events.map(x=>x.eventType)).toEqual(expect.arrayContaining(["MANUAL_OVERRIDE_APPLIED","VitalSignChanged","TrendChanged"]));
  });
});
