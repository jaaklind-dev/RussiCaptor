import type { AggregationEvent, ProcessOutput, RuntimeOverride, RuntimeState, RuntimeVitalAttribution } from "@/models/RuntimeAggregation";
import type { PatientVitalContributor, VitalSignConfiguration, VitalSignContributor, VitalSignEvent, VitalSignKey, VitalSignState } from "@/models/VitalSign";
import { defaultVitalSignConfiguration, VitalSignEngine } from "@/services/runtime/vitals/VitalSignEngine";
import { adaptLegacyVitalContributors } from "@/services/runtime/vitals/LegacyVitalContributorAdapter";
import { projectVitalSignState } from "@/services/runtime/vitals/VitalSignProjection";

const overrideVital: Record<string, VitalSignKey> = { hrTarget:"heartRate", sbpTarget:"systolicBp", dbpTarget:"diastolicBp",
  rrTarget:"respiratoryRate", spo2Target:"spo2", temperatureTarget:"temperature", crtSec:"crt" };

function explicitContributors(outputs: ProcessOutput[]): PatientVitalContributor[] {
  return [...outputs].sort((a,b)=>a.processId.localeCompare(b.processId)).flatMap(output =>
    (output.vitalContributions ?? []).map((item, index) => ({ contributorId:`${output.processId}:${index}`,
      sourceType:"PATIENT_PROCESS" as const, sourceId:output.processId, layer:"PROCESS" as const, ...item }))
  );
}

function previousState(previous: RuntimeState): VitalSignState | undefined {
  if (previous.vitalSignState) return previous.vitalSignState;
  const config = previous.vitalSignConfiguration ?? defaultVitalSignConfiguration;
  const projected = new VitalSignEngine().resolve({ timestamp: previous.exerciseTimeSec, configuration: config, contributors: [] }).state;
  const targets = previous.targetVitals; const displayed = previous.displayedVitals;
  const mapping: [VitalSignKey, number | undefined, number | undefined][] = [
    ["heartRate",targets.hr,displayed.hr], ["systolicBp",targets.sbp,displayed.sbp], ["diastolicBp",targets.dbp,displayed.dbp],
    ["respiratoryRate",targets.rr,displayed.rr], ["spo2",targets.spo2,displayed.spo2], ["temperature",targets.temperature,displayed.temperature], ["crt",targets.crt,displayed.crt],
  ];
  for (const [key,target,current] of mapping) if (target !== undefined || current !== undefined) projected.readings[key] = { ...projected.readings[key], target:target ?? current!, current:current ?? target! };
  return projected;
}

export type VitalRuntimeResolution = { state: VitalSignState; configuration: VitalSignConfiguration; attribution: RuntimeVitalAttribution; events: AggregationEvent[]; acceptedOverrideFields: string[] };

/** Frozen layer boundary: PatientProcess outputs -> VitalSignEngine. */
export function resolveVitalSignRuntime(previous: RuntimeState, outputs: ProcessOutput[], overrides: RuntimeOverride[] | undefined, timestamp: number): VitalRuntimeResolution {
  const legacy = adaptLegacyVitalContributors(outputs);
  const contributors: VitalSignContributor[] = [...legacy.contributors, ...explicitContributors(outputs)];
  const events = [...legacy.events]; const acceptedOverrideFields: string[] = [];
  for (const override of (overrides ?? []).filter(x => x.expiresAtSec === undefined || x.expiresAtSec >= timestamp)) {
    const vital = overrideVital[override.field];
    if (!vital || typeof override.value !== "number") continue;
    if (!override.authorized) { events.push({ eventType:"MANUAL_OVERRIDE_REJECTED", field:override.field, details:{eventId:override.eventId,actorId:override.actorId} }); continue; }
    contributors.push({ contributorId:`override:${override.eventId}`, sourceType:"MANUAL_OVERRIDE", sourceId:override.actorId,
      layer:"TEMPORARY", vital, operation:"OVERRIDE", value:override.value });
    acceptedOverrideFields.push(override.field);
    events.push({ eventType:"MANUAL_OVERRIDE_APPLIED", field:override.field, details:{eventId:override.eventId,actorId:override.actorId} });
  }
  const configuration = previous.vitalSignConfiguration ?? defaultVitalSignConfiguration;
  const result = new VitalSignEngine().resolve({ timestamp, configuration,
    previous: previousState(previous), contributors });
  events.push(...result.events.map(event => ({ eventType:event.eventType, field:event.vital, details:{from:event.from,to:event.to,sourceProcessId:event.sourceProcessId} })));
  const attribution = { ...legacy.attribution };
  for (const [runtimeField, vital] of Object.entries({ hr:"heartRate",sbp:"systolicBp",dbp:"diastolicBp",rr:"respiratoryRate",spo2:"spo2",temperature:"temperature",crt:"crt" }) as [string,VitalSignKey][]) {
    const sources = result.state.activeContributors.filter(x=>x.vital===vital); const winner = sources.at(-1);
    if (winner) attribution[runtimeField] = { primaryProcessId:winner.sourceId, contributorProcessIds:sources.slice(0,-1).map(x=>x.sourceId) };
  }
  // Projection is evaluated here to assert that every compatibility value is derivable.
  projectVitalSignState(result.state);
  return { state:result.state, configuration, attribution, events, acceptedOverrideFields };
}

export function vitalEvents(events: AggregationEvent[], timestamp: number): VitalSignEvent[] {
  return events.filter(x=>["VitalSignChanged","TrendChanged","MonitorStateChanged"].includes(x.eventType)).map(event => ({
    eventType:event.eventType as VitalSignEvent["eventType"], timestamp, vital:event.field as VitalSignKey | undefined,
    from:event.details?.from as number|string|undefined, to:event.details?.to as number|string|undefined, sourceProcessId:"VITAL_SIGN_ENGINE",
  }));
}
