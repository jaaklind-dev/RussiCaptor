import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { TransportConfiguration } from "@/models/PatientTransport";
import { PatientTransportEngine } from "@/services/runtime/PatientTransportEngine";

const configuration: TransportConfiguration = Object.freeze({
  version: "1.0.0", vehicleLocationId: "REANIMOBILE",
  resources: Object.freeze([{ resourceId: "NARVA-REANIMOBILE-01", resourceType: "CRITICAL_CARE_AMBULANCE",
    displayName: "Reanimobiil 01", capacity: 1, homeLocationId: "NARVA_ED" }]),
  destinations: Object.freeze([{ destinationId: "IVKH", displayName: "IVKH torakaalkeskus",
    capabilities: Object.freeze(["THORACIC_SURGERY"]), travelDurationSec: 1800,
    handoverDurationSec: 600, returnDurationSec: 1800, turnaroundDurationSec: 300 }]),
});
const fresh = () => new PatientTransportEngine(configuration, { "PT-CHEST-001": "NARVA_ED",
  "PT-PELVIC-001": "NARVA_ED" });
const restore = (source: PatientTransportEngine) =>
  new PatientTransportEngine(configuration, {}, source.snapshot());

describe("TRANSPORT-HARDENING-01 / TRANS-G01..G16", () => {
  test("TRANS-G01/G02/G05/G13 production submission is durable, readiness-gated and has no direct fallback", () => {
    const service = readFileSync(resolve(process.cwd(),
      "src/services/runtime/exercise/PatientTransportRuntimeService.ts"), "utf8");
    const ui = readFileSync(resolve(process.cwd(), "src/components/patient/PatientTransportControls.tsx"), "utf8");
    expect(service).toContain("runtimePatientCommandSubmissionReadiness");
    expect(service).toContain("submitPatientRuntimeCommand");
    expect(service).not.toContain("if (!getRuntimePatientCommandGateway())");
    const submissionBody=service.slice(service.indexOf("export async function submitPatientTransport"),
      service.indexOf("export function capturePatientTransportRuntime"));
    expect(submissionBody).not.toContain("startPatientTransport(");
    expect(ui).toContain("useRuntimePatientCommandSubmissionReadiness(exerciseId)");
    expect(ui).toContain("!commandReadiness.ready");
  });

  test("TRANS-G03 delayed materialization is anchored to accepted simulation time", () => {
    const engine = fresh(); engine.advanceTo(2000);
    engine.start("ACCEPTED-T100", "PT-CHEST-001", "NARVA-REANIMOBILE-01", "IVKH", 100);
    expect(engine.snapshot().transports[0]).toMatchObject({ requestedAtSec:100,onboardAtSec:100,
      departedAtSec:100,arrivedAtSec:1900,state:"ARRIVED" });
  });

  test("TRANS-G04/G07 same intent materializes once and a busy vehicle stays exclusive", () => {
    const engine=fresh(); const first=engine.start("ONE","PT-CHEST-001","NARVA-REANIMOBILE-01","IVKH",0);
    expect(engine.start("ONE","PT-CHEST-001","NARVA-REANIMOBILE-01","IVKH",0)).toEqual(first);
    expect(engine.start("TWO","PT-PELVIC-001","NARVA-REANIMOBILE-01","IVKH",0))
      .toMatchObject({ status:"REJECTED",reason:"TRANSPORT_RESOURCE_BUSY" });
    expect(engine.snapshot().transports).toHaveLength(1);
  });

  test("TRANS-G08 restart in transit preserves identity, deadline and single arrival", () => {
    const source=fresh(); source.start("T","PT-CHEST-001","NARVA-REANIMOBILE-01","IVKH",0); source.advanceTo(900);
    const next=restore(source); next.advanceTo(1800);
    const state=next.snapshot(); expect(state.transports[0]).toMatchObject({ transportId:"TRANSPORT-T",
      state:"ARRIVED",arrivedAtSec:1800 });
    expect(state.evidence.filter(item=>item.type==="TRANSPORT_ARRIVED")).toHaveLength(1);
  });

  test("TRANS-G09 restart during handover preserves arrival and completes handover once", () => {
    const source=fresh(); source.start("T","PT-CHEST-001","NARVA-REANIMOBILE-01","IVKH",0); source.advanceTo(2000);
    const next=restore(source); next.advanceTo(2400); const state=next.snapshot();
    expect(state.transports[0]).toMatchObject({ state:"HANDED_OVER",arrivedAtSec:1800,handedOverAtSec:2400 });
    expect(state.evidence.filter(item=>item.type==="TRANSPORT_HANDOVER_COMPLETED")).toHaveLength(1);
  });

  test("TRANS-G10 restart during return and turnaround preserves reuse threshold", () => {
    const returning=fresh(); returning.start("T","PT-CHEST-001","NARVA-REANIMOBILE-01","IVKH",0); returning.advanceTo(3000);
    const afterReturn=restore(returning); afterReturn.advanceTo(4199);
    expect(afterReturn.snapshot().resources[0].state).toBe("RETURNING");
    afterReturn.advanceTo(4200); expect(afterReturn.snapshot().resources[0].state).toBe("TURNAROUND");
    const turnaround=restore(afterReturn); turnaround.advanceTo(4499);
    expect(turnaround.snapshot().resources[0].state).toBe("TURNAROUND");
    turnaround.advanceTo(4500); expect(turnaround.snapshot().resources[0].state).toBe("AVAILABLE");
  });

  test.each([
    [900,1800,"TRANSPORT_ARRIVED"], [2000,2400,"TRANSPORT_HANDOVER_COMPLETED"],
    [3000,4500,"TRANSPORT_RESOURCE_AVAILABLE"],
  ] as const)("TRANS-G11/G12 takeover at T+%i crosses T+%i transition once", (takeoverAt,target,event) => {
    const writer=fresh(); writer.start("T","PT-CHEST-001","NARVA-REANIMOBILE-01","IVKH",0); writer.advanceTo(takeoverAt);
    const takeover=restore(writer); takeover.advanceTo(target); takeover.advanceTo(target);
    expect(takeover.snapshot().evidence.filter(item=>item.type===event)).toHaveLength(1);
  });

  test("TRANS-G15 reserves unreachable states and keeps cancellation unsupported", () => {
    const engine=fresh(); engine.start("T","PT-CHEST-001","NARVA-REANIMOBILE-01","IVKH",0);
    expect(engine.cancel("CANCEL","TRANSPORT-T",1)).toMatchObject({ status:"REJECTED",
      reason:"TRANSPORT_NOT_CANCELLABLE" });
    expect(engine.snapshot().transports[0].state).toBe("IN_TRANSIT");
  });

  test("TRANS-G16 transport completion never mutates clinical patient-completion state", () => {
    const engine=fresh(); engine.start("T","PT-CHEST-001","NARVA-REANIMOBILE-01","IVKH",0); engine.advanceTo(4500);
    expect(engine.snapshot().transports[0].state).toBe("COMPLETED");
    const engineSource=readFileSync(resolve(process.cwd(), "src/services/runtime/PatientTransportEngine.ts"), "utf8");
    expect(engineSource).not.toContain("finishPatient");
    expect(engineSource).not.toContain("setPatientStatus");
  });
});
