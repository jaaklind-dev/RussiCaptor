import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";

import { NarvaIroScenarioControlsCard, narvaIroScenarioControlsAvailable } from
  "@/components/excon/NarvaIroScenarioControlsCard";
import { publishResourceRuntimeDebugSnapshot } from "@/services/ResourceRuntimeDebugService";
import { setRuntimePatientCommandGateway, type RuntimePatientCommandGateway } from
  "@/services/runtime/commands/RuntimePatientCommandService";
import { observeSharedWorkflowHead } from "@/services/sharedWorkflow/SharedWorkflowMutationService";
import { replaceCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import type { NarvaIroScenarioProjection } from "@/models/NarvaIroScenario";

const iroScenario = (patientId: string, overrides: Partial<NarvaIroScenarioProjection> = {}): NarvaIroScenarioProjection => ({
  schemaVersion: 1, patientId, enabled: true, hold: false, arrest: false, cprQuality: false, rosc: false,
  goNoGoRequired: false, lastUpdatedSimulationTimeSec: 0, vasopressorStage: "S0", ventilationStage: "NORMAL",
  heartRate: 92, systolicBp: 105, diastolicBp: 62, spo2: 96, etco2: 4.8, pulsePresent: true,
  etco2WaveformPresent: true, exhaledVolumeReduced: false, oxygenSourceAdequate: true,
  ventilatorRunning: true, causesCorrected: true, roscEligible: false, ...overrides,
});

const publishScenario = (scenario: NarvaIroScenarioProjection) => publishResourceRuntimeDebugSnapshot({
  resources: [], activeInterventions: [], recentEvents: [], updatedAt: scenario.lastUpdatedSimulationTimeSec,
  narvaIroScenario: scenario,
}, scenario.patientId);

const renderedText = (renderer: TestRenderer.ReactTestRenderer): string => renderer.root.findAllByType("Text" as never)
  .map(node => Array.isArray(node.props.children) ? node.props.children.join("") : String(node.props.children)).join("\n");

const pressRenderedControl = async (renderer: TestRenderer.ReactTestRenderer, accessibilityLabel: string): Promise<void> => {
  const responder = renderer.root.findAll((node: ReactTestInstance) => node.props.accessibilityLabel === accessibilityLabel &&
    typeof node.props.onStartShouldSetResponder === "function")[0];
  if (!responder) throw new Error(`No rendered responder for ${accessibilityLabel}`);
  const target = { measure: (callback: (left: number, top: number, width: number, height: number,
    pageX: number, pageY: number) => void) => callback(0, 0, 100, 100, 0, 0) };
  const event = { currentTarget: target, target, persist: jest.fn(), stopPropagation: jest.fn(),
    nativeEvent: { pageX: 10, pageY: 10, locationX: 10, locationY: 10, timestamp: Date.now() } };
  await act(async () => {
    expect(responder.props.onStartShouldSetResponder()).toBe(true);
    responder.props.onResponderGrant(event);
    responder.props.onResponderRelease(event);
    await Promise.resolve();
  });
};

const gatewayWithResult = (result: RuntimePatientCommandGateway["submit"] extends (...args: never[]) => Promise<infer R> ? R : never,
  materialization?: { status: "MATERIALIZED" | "REJECTED"; result: Readonly<Record<string, unknown>> }) => ({
    submit: jest.fn(async () => result),
    loadAfter: jest.fn(async () => []),
    loadResult: jest.fn(async () => materialization),
    record: jest.fn(async () => undefined),
  } satisfies RuntimePatientCommandGateway);

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
    await pressRenderedControl(renderer, "Alusta katkestust");
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

  test("rerenders a mounted card when its patient-scoped authoritative projection changes", async () => {
    const scenario = (time: number, active: boolean) => ({
      schemaVersion: 1 as const, patientId: "PT-IRO-001", enabled: true as const, hold: false,
      arrest: false, cprQuality: false, rosc: false, goNoGoRequired: false,
      lastUpdatedSimulationTimeSec: time,
      ...(active ? { vasopressorFault: { startedAtSimulationTimeSec: 30, accumulatedHoldSec: 0 } } : {}),
      vasopressorStage: active ? "S1" as const : "S0" as const,
      ventilationStage: "NORMAL" as const, heartRate: active ? 105 : 92,
      systolicBp: active ? 90 : 105, diastolicBp: active ? 50 : 62, spo2: 96, etco2: 4.8,
      pulsePresent: true, etco2WaveformPresent: true, exhaledVolumeReduced: false,
      oxygenSourceAdequate: true, ventilatorRunning: true, causesCorrected: !active, roscEligible: false,
    });
    publishResourceRuntimeDebugSnapshot({ resources: [], activeInterventions: [], recentEvents: [], updatedAt: 0,
      narvaIroScenario: scenario(0, false) }, "PT-IRO-001");
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<NarvaIroScenarioControlsCard
      exerciseId="EX-IRO-UI" patientId="PT-IRO-001" />); });
    await act(async () => { publishResourceRuntimeDebugSnapshot({ resources: [], activeInterventions: [],
      recentEvents: [], updatedAt: 60, narvaIroScenario: scenario(60, true) }, "PT-IRO-001"); });
    const text = renderer.root.findAllByType("Text" as never).map(node =>
      Array.isArray(node.props.children) ? node.props.children.join("") : String(node.props.children)).join("\n");
    expect(text).toContain("Vasopressor: aktiivne · S1");
    expect(text).toContain("T+60s");
    expect(renderer.root.findByProps({ accessibilityLabel: "Taasta vasopressor" }).props.disabled).toBe(false);
    await act(async () => renderer.unmount());
  });

  test("converges repeated START, CORRECT, ventilation, HOLD and RESUME publications without remount", async () => {
    publishScenario(iroScenario("PT-IRO-001"));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<NarvaIroScenarioControlsCard
      exerciseId="EX-IRO-UI" patientId="PT-IRO-001" />); });
    await act(async () => publishScenario(iroScenario("PT-IRO-001", { lastUpdatedSimulationTimeSec: 30,
      vasopressorFault: { startedAtSimulationTimeSec: 0, accumulatedHoldSec: 0 }, vasopressorStage: "S1" })));
    expect(renderedText(renderer)).toContain("Vasopressor: aktiivne · S1");
    expect(renderer.root.findByProps({ accessibilityLabel: "Taasta vasopressor" }).props.disabled).toBe(false);
    await act(async () => publishScenario(iroScenario("PT-IRO-001", { lastUpdatedSimulationTimeSec: 60,
      vasopressorFault: { startedAtSimulationTimeSec: 0, accumulatedHoldSec: 0 }, vasopressorStage: "S2" })));
    expect(renderedText(renderer)).toContain("Vasopressor: aktiivne · S2");
    await act(async () => publishScenario(iroScenario("PT-IRO-001", { lastUpdatedSimulationTimeSec: 75,
      vasopressorFault: { startedAtSimulationTimeSec: 0, correctedAtSimulationTimeSec: 75, accumulatedHoldSec: 0 },
      vasopressorStage: "S2R" })));
    expect(renderedText(renderer)).toContain("Vasopressor: parandatud · S2R");
    await act(async () => publishScenario(iroScenario("PT-IRO-001", { lastUpdatedSimulationTimeSec: 90,
      ventilationFault: { type: "CIRCUIT_DISCONNECT", startedAtSimulationTimeSec: 90, accumulatedHoldSec: 0 },
      ventilationStage: "DETERIORATING" })));
    expect(renderedText(renderer)).toContain("Ventilatsioon: aktiivne · Kontuuri ühenduse katkemine · DETERIORATING");
    expect(renderer.root.findByProps({ accessibilityLabel: "Taasta ventilatsioon" }).props.disabled).toBe(false);
    await act(async () => publishScenario(iroScenario("PT-IRO-001", { hold: true, lastUpdatedSimulationTimeSec: 105,
      ventilationFault: { type: "CIRCUIT_DISCONNECT", startedAtSimulationTimeSec: 90, accumulatedHoldSec: 0,
        heldAtSimulationTimeSec: 105 }, ventilationStage: "DETERIORATING" })));
    expect(renderedText(renderer)).toContain("Stsenaariumikell: HOLD");
    expect(renderer.root.findByProps({ accessibilityLabel: "RESUME" }).props.disabled).toBe(false);
    await act(async () => publishScenario(iroScenario("PT-IRO-001", { lastUpdatedSimulationTimeSec: 120,
      ventilationFault: { type: "CIRCUIT_DISCONNECT", startedAtSimulationTimeSec: 90, accumulatedHoldSec: 15 },
      ventilationStage: "DETERIORATING" })));
    expect(renderedText(renderer)).toContain("Stsenaariumikell: RUNNING");
    expect(renderedText(renderer)).toContain("T+120s");
    await act(async () => renderer.unmount());
  });

  test("isolates unrelated patients and resubscribes when the selected patient changes", async () => {
    publishScenario(iroScenario("PT-A", { lastUpdatedSimulationTimeSec: 40,
      vasopressorFault: { startedAtSimulationTimeSec: 10, accumulatedHoldSec: 0 }, vasopressorStage: "S1" }));
    publishScenario(iroScenario("PT-B", { lastUpdatedSimulationTimeSec: 5 }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<NarvaIroScenarioControlsCard
      exerciseId="EX-IRO-UI" patientId="PT-A" />); });
    await act(async () => publishScenario(iroScenario("PT-B", { lastUpdatedSimulationTimeSec: 60,
      ventilationFault: { type: "CIRCUIT_DISCONNECT", startedAtSimulationTimeSec: 30, accumulatedHoldSec: 0 },
      ventilationStage: "DETERIORATING" })));
    expect(renderedText(renderer)).toContain("Vasopressor: aktiivne · S1");
    expect(renderedText(renderer)).not.toContain("Ventilatsioon: aktiivne");
    await act(async () => renderer.update(<NarvaIroScenarioControlsCard exerciseId="EX-IRO-UI" patientId="PT-B" />));
    expect(renderedText(renderer)).toContain("Ventilatsioon: aktiivne · Kontuuri ühenduse katkemine · DETERIORATING");
    await act(async () => publishScenario(iroScenario("PT-A", { lastUpdatedSimulationTimeSec: 90 })));
    expect(renderedText(renderer)).toContain("T+60s");
    await act(async () => renderer.unmount());
  });

  test("real START press crosses the rendered responder and submits exactly one canonical command", async () => {
    replaceCanonicalExerciseSnapshot({ exerciseId: "EX-IRO-PRESS", lifecycleState: "RUNNING",
      simulationTimeSec: 12, speed: 1, version: 2, clockVersion: 1, clockInitializedAtSimulationTimeSec: 0 });
    observeSharedWorkflowHead("EX-IRO-PRESS", "PT-IRO-001", 0);
    publishScenario(iroScenario("PT-IRO-001", { lastUpdatedSimulationTimeSec: 12 }));
    const gateway = gatewayWithResult({ status: "APPLIED", patientRevision: 1, commandSequence: 7 },
      { status: "MATERIALIZED", result: { ok: true } });
    setRuntimePatientCommandGateway(gateway);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<NarvaIroScenarioControlsCard
      exerciseId="EX-IRO-PRESS" patientId="PT-IRO-001" />); });
    await pressRenderedControl(renderer, "Alusta katkestust");
    expect(gateway.submit).toHaveBeenCalledTimes(1);
    expect(gateway.submit).toHaveBeenCalledWith(expect.objectContaining({ exerciseId: "EX-IRO-PRESS",
      patientId: "PT-IRO-001", commandType: "IRO_VASOPRESSOR_FAULT_START", payload: {} }));
    expect(renderedText(renderer)).toContain("Käsk rakendati autoritaarses Runtime’is.");
    await act(async () => renderer.unmount());
  });

  test("accessibility activation uses the same stable submit path exactly once", async () => {
    replaceCanonicalExerciseSnapshot({ exerciseId: "EX-IRO-ACCESSIBILITY", lifecycleState: "RUNNING",
      simulationTimeSec: 12, speed: 1, version: 2, clockVersion: 1, clockInitializedAtSimulationTimeSec: 0 });
    observeSharedWorkflowHead("EX-IRO-ACCESSIBILITY", "PT-IRO-001", 0);
    publishScenario(iroScenario("PT-IRO-001", { lastUpdatedSimulationTimeSec: 12 }));
    const gateway = gatewayWithResult({ status: "APPLIED", patientRevision: 1, commandSequence: 8 },
      { status: "MATERIALIZED", result: { ok: true } });
    setRuntimePatientCommandGateway(gateway);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<NarvaIroScenarioControlsCard
      exerciseId="EX-IRO-ACCESSIBILITY" patientId="PT-IRO-001" />); });
    const control = renderer.root.findByProps({ testID: "iro-control-IRO_VASOPRESSOR_FAULT_START" });
    expect(control.props.accessibilityRole).toBe("button");
    expect(control.props.accessibilityLabel).toBe("Alusta katkestust");
    expect(control.props.accessibilityState.disabled).toBe(false);
    await act(async () => { control.props.onPress(); await Promise.resolve(); });
    expect(gateway.submit).toHaveBeenCalledTimes(1);
    expect(gateway.submit).toHaveBeenCalledWith(expect.objectContaining({ exerciseId: "EX-IRO-ACCESSIBILITY",
      patientId: "PT-IRO-001", commandType: "IRO_VASOPRESSOR_FAULT_START", payload: {} }));
    await act(async () => renderer.unmount());
  });

  test("keeps the enabled responder stable across live projection rerenders", async () => {
    replaceCanonicalExerciseSnapshot({ exerciseId: "EX-IRO-STABLE-PRESS", lifecycleState: "RUNNING",
      simulationTimeSec: 12, speed: 1, version: 2, clockVersion: 1, clockInitializedAtSimulationTimeSec: 0 });
    observeSharedWorkflowHead("EX-IRO-STABLE-PRESS", "PT-IRO-001", 0);
    publishScenario(iroScenario("PT-IRO-001"));
    const gateway = gatewayWithResult({ status: "APPLIED", patientRevision: 1, commandSequence: 1 },
      { status: "MATERIALIZED", result: { ok: true } });
    setRuntimePatientCommandGateway(gateway);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<NarvaIroScenarioControlsCard
      exerciseId="EX-IRO-STABLE-PRESS" patientId="PT-IRO-001" />); });
    const before = renderer.root.findByProps({ testID: "iro-control-IRO_VASOPRESSOR_FAULT_START" });
    const beforeOnPress = before.props.onPress;
    await act(async () => publishScenario(iroScenario("PT-IRO-001", { lastUpdatedSimulationTimeSec: 1 })));
    const after = renderer.root.findByProps({ testID: "iro-control-IRO_VASOPRESSOR_FAULT_START" });
    expect(after.props.onPress).toBe(beforeOnPress);
    await pressRenderedControl(renderer, "Alusta katkestust");
    expect(gateway.submit).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  test("shows submitting immediately, coalesces rapid duplicate presses, and reports rejection", async () => {
    replaceCanonicalExerciseSnapshot({ exerciseId: "EX-IRO-PENDING", lifecycleState: "RUNNING",
      simulationTimeSec: 12, speed: 1, version: 2, clockVersion: 1, clockInitializedAtSimulationTimeSec: 0 });
    observeSharedWorkflowHead("EX-IRO-PENDING", "PT-IRO-001", 0);
    publishScenario(iroScenario("PT-IRO-001"));
    let resolveSubmit!: (result: { status: "AUTHORIZATION_DENIED"; patientRevision: number }) => void;
    const pending = new Promise<{ status: "AUTHORIZATION_DENIED"; patientRevision: number }>(resolve => { resolveSubmit = resolve; });
    const gateway: RuntimePatientCommandGateway = { submit: jest.fn(() => pending), loadAfter: jest.fn(async () => []),
      loadResult: jest.fn(async () => undefined), record: jest.fn(async () => undefined) };
    setRuntimePatientCommandGateway(gateway);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<NarvaIroScenarioControlsCard
      exerciseId="EX-IRO-PENDING" patientId="PT-IRO-001" />); });
    await pressRenderedControl(renderer, "Alusta katkestust");
    expect(renderedText(renderer)).toContain("Saadan käsku…");
    const disabledStart = renderer.root.findByProps({ testID: "iro-control-IRO_VASOPRESSOR_FAULT_START" });
    expect(disabledStart.props.disabled).toBe(true);
    expect(disabledStart.props.accessibilityState.disabled).toBe(true);
    expect(gateway.submit).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAll((node: ReactTestInstance) => node.props.accessibilityLabel === "Alusta katkestust" &&
      typeof node.props.onStartShouldSetResponder === "function")[0].props.onStartShouldSetResponder()).toBe(false);
    await act(async () => { resolveSubmit({ status: "AUTHORIZATION_DENIED", patientRevision: 0 }); await pending; });
    expect(renderedText(renderer)).toContain("Käsk lükati tagasi: IRO juhtimiseks on vajalik aktiivne õppuse EXCON-õigus.");
    await act(async () => renderer.unmount());
  });

  test("enables one ordered CORRECT follow-up after RESUME is durably accepted", async () => {
    replaceCanonicalExerciseSnapshot({ exerciseId: "EX-IRO-RESUME-CORRECT", lifecycleState: "RUNNING",
      simulationTimeSec: 1780, speed: 1, version: 2, clockVersion: 1, clockInitializedAtSimulationTimeSec: 0 });
    observeSharedWorkflowHead("EX-IRO-RESUME-CORRECT", "PT-IRO-001", 0);
    publishScenario(iroScenario("PT-IRO-001", { hold: true, lastUpdatedSimulationTimeSec: 1780,
      ventilationFault: { type: "CIRCUIT_DISCONNECT", startedAtSimulationTimeSec: 988,
        accumulatedHoldSec: 0, heldAtSimulationTimeSec: 1106 }, ventilationStage: "CRITICAL" }));
    let resolveResume!: (value: { status: "MATERIALIZED"; result: Readonly<Record<string, unknown>> }) => void;
    let resolveCorrect!: (value: { status: "MATERIALIZED"; result: Readonly<Record<string, unknown>> }) => void;
    const resumeResult = new Promise<{ status: "MATERIALIZED"; result: Readonly<Record<string, unknown>> }>(resolve => {
      resolveResume = resolve;
    });
    const correctResult = new Promise<{ status: "MATERIALIZED"; result: Readonly<Record<string, unknown>> }>(resolve => {
      resolveCorrect = resolve;
    });
    const submit = jest.fn(async command => ({ status: "APPLIED" as const,
        patientRevision: command.commandType === "IRO_RESUME" ? 1 : 2,
        commandSequence: command.commandType === "IRO_RESUME" ? 100 : 101 }));
    const gateway: RuntimePatientCommandGateway = {
      submit,
      loadAfter: jest.fn(async () => []),
      loadResult: jest.fn(async (_exercise, sequence) => sequence === 100 ? resumeResult : correctResult),
      record: jest.fn(async () => undefined),
    };
    setRuntimePatientCommandGateway(gateway);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<NarvaIroScenarioControlsCard
      exerciseId="EX-IRO-RESUME-CORRECT" patientId="PT-IRO-001" />); });
    await pressRenderedControl(renderer, "RESUME");
    expect(renderer.root.findByProps({ accessibilityLabel: "Taasta ventilatsioon" }).props.disabled).toBe(false);
    await pressRenderedControl(renderer, "Taasta ventilatsioon");
    expect(gateway.submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls.map(call => call[0].commandType)).toEqual([
      "IRO_RESUME", "IRO_VENTILATION_FAULT_CORRECT",
    ]);
    expect(renderer.root.findByProps({ accessibilityLabel: "Taasta ventilatsioon" }).props.disabled).toBe(true);
    await act(async () => {
      resolveCorrect({ status: "MATERIALIZED", result: { ok: true } });
      await correctResult;
    });
    expect(renderer.root.findByProps({ accessibilityLabel: "Taasta ventilatsioon" }).props.disabled).toBe(true);
    await act(async () => {
      resolveResume({ status: "MATERIALIZED", result: { ok: true } });
      await resumeResult;
    });
    expect(renderedText(renderer)).toContain("Käsk rakendati autoritaarses Runtime’is.");
    await act(async () => renderer.unmount());
  });

  test.each([
    ["Taasta vasopressor", "IRO_VASOPRESSOR_FAULT_CORRECT" as const,
      { vasopressorFault: { startedAtSimulationTimeSec: 1, accumulatedHoldSec: 0 } }],
    ["Alusta ventilatsiooniriket", "IRO_VENTILATION_FAULT_START" as const, {}],
    ["Taasta ventilatsioon", "IRO_VENTILATION_FAULT_CORRECT" as const,
      { ventilationFault: { type: "CIRCUIT_DISCONNECT" as const, startedAtSimulationTimeSec: 1, accumulatedHoldSec: 0 } }],
    ["HOLD", "IRO_HOLD" as const, {}],
    ["RESUME", "IRO_RESUME" as const, { hold: true }],
  ])("real %s press submits %s", async (label, commandType, overrides) => {
    replaceCanonicalExerciseSnapshot({ exerciseId: "EX-IRO-CONTROLS", lifecycleState: "RUNNING",
      simulationTimeSec: 12, speed: 1, version: 2, clockVersion: 1, clockInitializedAtSimulationTimeSec: 0 });
    observeSharedWorkflowHead("EX-IRO-CONTROLS", "PT-IRO-001", 0);
    publishScenario(iroScenario("PT-IRO-001", overrides));
    const gateway = gatewayWithResult({ status: "APPLIED", patientRevision: 1, commandSequence: 1 },
      { status: "MATERIALIZED", result: { ok: true } });
    setRuntimePatientCommandGateway(gateway);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<NarvaIroScenarioControlsCard
      exerciseId="EX-IRO-CONTROLS" patientId="PT-IRO-001" />); });
    await pressRenderedControl(renderer, label);
    expect(gateway.submit).toHaveBeenCalledTimes(1);
    expect(gateway.submit).toHaveBeenCalledWith(expect.objectContaining({ commandType,
      ...(commandType === "IRO_VENTILATION_FAULT_START" ? { payload: { faultType: "CIRCUIT_DISCONNECT" } } : { payload: {} }) }));
    await act(async () => renderer.unmount());
  });

  test("disabled controls expose matching visual and accessibility state and do not submit", async () => {
    publishScenario(iroScenario("PT-IRO-001", { vasopressorFault: { startedAtSimulationTimeSec: 1,
      accumulatedHoldSec: 0 }, ventilationFault: { type: "CIRCUIT_DISCONNECT", startedAtSimulationTimeSec: 1,
        accumulatedHoldSec: 0 }, hold: true }));
    const gateway = gatewayWithResult({ status: "APPLIED", patientRevision: 1, commandSequence: 1 },
      { status: "MATERIALIZED", result: { ok: true } });
    setRuntimePatientCommandGateway(gateway);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<NarvaIroScenarioControlsCard
      exerciseId="EX-IRO-DISABLED" patientId="PT-IRO-001" />); });
    for (const commandType of ["IRO_VASOPRESSOR_FAULT_START", "IRO_VENTILATION_FAULT_START", "IRO_HOLD"] as const) {
      const control = renderer.root.findByProps({ testID: `iro-control-${commandType}` });
      expect(control.props.disabled).toBe(true);
      expect(control.props.accessibilityState.disabled).toBe(true);
    }
    expect(gateway.submit).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });
});
