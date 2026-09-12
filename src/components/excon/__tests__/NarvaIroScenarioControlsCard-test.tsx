import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import { NarvaIroScenarioControlsCard, narvaIroScenarioControlsAvailable } from
  "@/components/excon/NarvaIroScenarioControlsCard";
import { publishResourceRuntimeDebugSnapshot } from "@/services/ResourceRuntimeDebugService";
import { setRuntimePatientCommandGateway, type RuntimePatientCommandGateway } from
  "@/services/runtime/commands/RuntimePatientCommandService";
import { observeSharedWorkflowHead } from "@/services/sharedWorkflow/SharedWorkflowMutationService";
import { replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";

describe("IRO EXCON scenario-control presentation", () => {
  afterEach(() => setRuntimePatientCommandGateway(undefined));

  test("is visible only for authorized RUNNING IRO 1.0.1 context", () => {
    const base = { packageId: "russicaptor.narva-iro-evacuation", packageVersion: "1.0.1",
      lifecycleState: "RUNNING", authorized: true, patientId: "PT-IRO-001" };
    expect(narvaIroScenarioControlsAvailable(base)).toBe(true);
    expect(narvaIroScenarioControlsAvailable({ ...base, authorized: false })).toBe(false);
    expect(narvaIroScenarioControlsAvailable({ ...base, lifecycleState: "COMPLETED" })).toBe(false);
    expect(narvaIroScenarioControlsAvailable({ ...base, packageId: "russicaptor.narva-trauma" })).toBe(false);
    expect(narvaIroScenarioControlsAvailable({ ...base, packageVersion: "1.0.0" })).toBe(false);
  });

  test("shows accepted pending state and only then authoritative materialization", async () => {
    replaceCanonicalExerciseSnapshot({ exerciseId: "EX-IRO-UI", lifecycleState: "RUNNING",
      simulationTimeSec: 30, speed: 1, version: 2, clockVersion: 1, clockInitializedAtSimulationTimeSec: 0 });
    observeSharedWorkflowHead("EX-IRO-UI", "PT-IRO-001", 0);
    let resolveResult: ((value: { status: "MATERIALIZED"; result: Readonly<Record<string, unknown>> }) => void) | undefined;
    const result = new Promise<{ status: "MATERIALIZED"; result: Readonly<Record<string, unknown>> }>(resolve => {
      resolveResult = resolve;
    });
    const gateway: RuntimePatientCommandGateway = {
      submit: jest.fn(async () => ({ status: "APPLIED" as const, patientRevision: 1, commandSequence: 1 })),
      loadAfter: jest.fn(async () => []),
      loadResult: jest.fn(async () => result),
      record: jest.fn(async () => undefined),
    };
    setRuntimePatientCommandGateway(gateway);
    publishResourceRuntimeDebugSnapshot({ resources: [], activeInterventions: [], recentEvents: [], updatedAt: 30,
      narvaIroScenario: { schemaVersion: 1, patientId: "PT-IRO-001", enabled: true, hold: false,
        arrest: false, cprQuality: false, rosc: false, goNoGoRequired: false, lastUpdatedSimulationTimeSec: 30,
        vasopressorStage: "S0", ventilationStage: "NORMAL", heartRate: 92, systolicBp: 105,
        diastolicBp: 62, spo2: 96, etco2: 4.8, pulsePresent: true, etco2WaveformPresent: true,
        exhaledVolumeReduced: false, oxygenSourceAdequate: true, ventilatorRunning: true,
        causesCorrected: true, roscEligible: false } });
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<NarvaIroScenarioControlsCard
      exerciseId="EX-IRO-UI" patientId="PT-IRO-001" />); });
    expect(renderer.root.findAllByType("Text" as never).some(node =>
      (Array.isArray(node.props.children) ? node.props.children.join("") : String(node.props.children))
        .includes("Vasopressor: puudub"))).toBe(true);
    const start = renderer.root.findByProps({ accessibilityLabel: "Alusta katkestust" });
    await act(async () => { start.props.onPress(); await Promise.resolve(); });
    expect(renderer.root.findAllByType("Text" as never).some(node =>
      String(node.props.children).includes("ootan Runtime’i kinnitust"))).toBe(true);
    await act(async () => { resolveResult?.({ status: "MATERIALIZED", result: { ok: true } }); await result; });
    expect(renderer.root.findAllByType("Text" as never).some(node =>
      String(node.props.children).includes("rakendati autoritaarses Runtime’is"))).toBe(true);
    await act(async () => renderer.unmount());
  });

  test("uses the patient-scoped authoritative projection after another global snapshot publishes", async () => {
    const activeScenario = { schemaVersion: 1 as const, patientId: "PT-IRO-001", enabled: true as const, hold: true,
      arrest: false, cprQuality: false, rosc: false, goNoGoRequired: false, lastUpdatedSimulationTimeSec: 75,
      vasopressorFault: { startedAtSimulationTimeSec: 15, accumulatedHoldSec: 0, heldAtSimulationTimeSec: 75 },
      ventilationFault: { type: "CIRCUIT_DISCONNECT" as const, startedAtSimulationTimeSec: 45,
        accumulatedHoldSec: 0, heldAtSimulationTimeSec: 75 }, vasopressorStage: "S2" as const,
      ventilationStage: "DETERIORATING" as const, heartRate: 120, systolicBp: 75, diastolicBp: 40,
      spo2: 90, pulsePresent: true, etco2WaveformPresent: false, exhaledVolumeReduced: true,
      oxygenSourceAdequate: true, ventilatorRunning: true, causesCorrected: false, roscEligible: false };
    publishResourceRuntimeDebugSnapshot({ resources: [], activeInterventions: [], recentEvents: [], updatedAt: 75,
      narvaIroScenario: activeScenario }, "PT-IRO-001");
    publishResourceRuntimeDebugSnapshot({ resources: [], activeInterventions: [], recentEvents: [], updatedAt: 0 });
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<NarvaIroScenarioControlsCard
      exerciseId="EX-IRO-UI" patientId="PT-IRO-001" />); });
    const text = renderer.root.findAllByType("Text" as never).map(node =>
      Array.isArray(node.props.children) ? node.props.children.join("") : String(node.props.children)).join("\n");
    expect(text).toContain("Vasopressor: aktiivne · S2");
    expect(text).toContain("Ventilatsioon: aktiivne · Kontuuri ühenduse katkemine · DETERIORATING");
    expect(text).toContain("Stsenaariumikell: HOLD");
    expect(text).toContain("T+75s");
    expect(renderer.root.findByProps({ accessibilityLabel: "Taasta vasopressor" }).props.disabled).toBe(false);
    expect(renderer.root.findByProps({ accessibilityLabel: "RESUME" }).props.disabled).toBe(false);
    await act(async () => renderer.unmount());
  });
});
