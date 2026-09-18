import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import LaboratoryWorkflowCard from "../LaboratoryWorkflowCard";
import { clearLaboratoryActionTraceForValidation, getLaboratoryActionTrace } from
  "../LaboratoryActionDiagnostics";
import type { LaboratoryWorkflowSnapshot } from "@/models/LaboratoryWorkflow";

const processing: LaboratoryWorkflowSnapshot = Object.freeze({ schemaVersion: 1,
  orders: [Object.freeze({ orderId: "ORDER-1", exerciseId: "EX", patientId: "PT",
    packageId: "NARVA_IRO_ASTRUP", orderedAtSimulationTimeSec: 90, orderedBy: "CM", status: "ORDERED" })],
  samples: [], resultGroups: [], patientBloodIdentities: {} });
const resulted: LaboratoryWorkflowSnapshot = Object.freeze({ schemaVersion: 1,
  orders: [Object.freeze({ ...processing.orders[0], status: "COLLECTED" })],
  samples: [Object.freeze({ sampleId: "SAMPLE-1", orderId: "ORDER-1", exerciseId: "EX", patientId: "PT",
    sampledAtSimulationTimeSec: 100, sourcePatientRevision: 7, sourceRuntimeStateVersion: 9,
    snapshot: Object.freeze({ schemaVersion: 1, displayedVitals: {}, targetVitals: {}, runtimeFields: {},
      clinicalProcessInputs: [] }) })],
  resultGroups: [Object.freeze({ resultGroupId: "RESULT-1", sampleId: "SAMPLE-1", type: "ASTRUP",
    availableAtSimulationTimeSec: 1600, status: "PARTIALLY_RESULTED",
    generationVersion: "narva-lab-physiology-v1", resultPayload: Object.freeze({ analytes: [
      Object.freeze({ analyteId: "LAB_PH", value: 7.12, unit: "" }),
      Object.freeze({ analyteId: "LAB_ICA", value: 0.91, unit: "mmol/L" }),
    ] }) })], patientBloodIdentities: {} });
const empty: LaboratoryWorkflowSnapshot = Object.freeze({ schemaVersion: 1, orders: [], samples: [],
  resultGroups: [], patientBloodIdentities: {} });

const actionByLabel = (renderer: TestRenderer.ReactTestRenderer, label: string) =>
  renderer.root.findAllByProps({ accessibilityLabel: label })
    .find(node => typeof node.props.onPress === "function")!;
const actionByTestId = (renderer: TestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAllByProps({ testID }).find(node => typeof node.props.onPress === "function")!;
const actionsByTestId = (renderer: TestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAllByProps({ testID }).filter(node => typeof node.props.onPress === "function");

describe("LaboratoryWorkflowCard canonical Runtime projection", () => {
  test("shows IRO order action and suppresses duplicate rapid submissions", async () => {
    let resolve!: (value: { ok: boolean; message: string }) => void;
    const onOrder = jest.fn(() => new Promise<{ ok: boolean; message: string }>(done => { resolve = done; }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard packageId="NARVA_IRO_ASTRUP"
      onOrder={onOrder} onCollect={jest.fn()} />); });
    const button = actionByLabel(renderer, "Telli Astrup");
    await act(async () => { button.props.onPress(); button.props.onPress(); });
    expect(onOrder).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: true, message: "ok" }));
  });

  test("shows trauma package collection action and suppresses duplicate in-flight taps", async () => {
    let resolve!: (value: { ok: boolean; message: string }) => void;
    const onCollect = jest.fn(() => new Promise<{ ok: boolean; message: string }>(done => { resolve = done; }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={processing}
      packageId="NARVA_POLYTRAUMA" onOrder={jest.fn()} onCollect={onCollect} />); });
    const button = actionByLabel(renderer, "Kogu laboriproov");
    await act(async () => { button.props.onPress(); button.props.onPress(); });
    expect(onCollect).toHaveBeenCalledTimes(1);
    expect(onCollect).toHaveBeenCalledWith("ORDER-1");
    await act(async () => resolve({ ok: true, message: "ok" }));
  });

  test("keeps ORDER action identity stable during same-semantic reader rehydration", async () => {
    const onOrder = jest.fn(async () => ({ ok: true, message: "ok" }));
    const onCollect = jest.fn(async () => ({ ok: true, message: "ok" }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard packageId="NARVA_IRO_ASTRUP"
      onOrder={onOrder} onCollect={onCollect} />); });
    const before = actionByTestId(renderer, "laboratory-order-action");
    const press = before.props.onPress;
    await act(async () => { renderer.update(<LaboratoryWorkflowCard workflow={Object.freeze({ schemaVersion: 1,
      orders: [], samples: [], resultGroups: [], patientBloodIdentities: {} })} packageId="NARVA_IRO_ASTRUP"
      onOrder={onOrder} onCollect={onCollect} />); });
    const after = actionByTestId(renderer, "laboratory-order-action");
    expect(after).toBe(before);
    expect(after.props.onPress).toBe(press);
    await act(async () => { press(); press(); });
    expect(onOrder).toHaveBeenCalledTimes(1);
    expect(onCollect).not.toHaveBeenCalled();
  });

  test("keeps one native action target mounted when authoritative ORDER becomes COLLECT", async () => {
    const onOrder = jest.fn(async () => ({ ok: true, message: "ok" }));
    const onCollect = jest.fn(async () => ({ ok: true, message: "ok" }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard packageId="NARVA_IRO_ASTRUP"
      onOrder={onOrder} onCollect={onCollect} />); });
    const order = actionByTestId(renderer, "laboratory-order-action");
    await act(async () => { renderer.update(<LaboratoryWorkflowCard workflow={processing}
      packageId="NARVA_IRO_ASTRUP" onOrder={onOrder} onCollect={onCollect} />); });
    const collect = actionByTestId(renderer, "laboratory-collect-action");
    expect(collect).toBe(order);
    expect(renderer.root.findAllByProps({ testID: "laboratory-order-action" })).toHaveLength(0);
    await act(async () => { collect.props.onPress(); collect.props.onPress(); });
    expect(onOrder).not.toHaveBeenCalled();
    expect(onCollect).toHaveBeenCalledTimes(1);
    expect(onCollect).toHaveBeenCalledWith("ORDER-1");
  });

  test("keeps the enabled action target mounted while reader readiness transiently drops", async () => {
    const onOrder = jest.fn(async () => ({ ok: true, message: "ok" }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={empty}
      workflowScopeKey="EX:PT" projectionRevision={80} packageId="NARVA_IRO_ASTRUP"
      onOrder={onOrder} onCollect={jest.fn()} />); });
    const before = actionByTestId(renderer, "laboratory-order-action");
    await act(async () => { renderer.update(<LaboratoryWorkflowCard workflow={empty}
      workflowScopeKey="EX:PT" projectionRevision={80} projectionReady={false}
      packageId="NARVA_IRO_ASTRUP" onOrder={onOrder} onCollect={jest.fn()} />); });
    const after = actionByTestId(renderer, "laboratory-order-action");
    expect(after).toBe(before);
    expect(after.props.disabled).toBe(false);
    await act(async () => { after.props.onPress(); });
    expect(onOrder).toHaveBeenCalledTimes(1);
  });

  test("keeps ORDER disabled while the durable command path is synchronizing", async () => {
    const onOrder = jest.fn(async () => ({ ok: true, message: "ok" }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={empty}
      workflowScopeKey="EX:PT" projectionRevision={80} packageId="NARVA_IRO_ASTRUP"
      commandReadiness={{ ready: false, reason: "Patsiendi Runtime sünkroniseerib värskeimat kontrollpunkti." }}
      onOrder={onOrder} onCollect={jest.fn()} />); });
    const button = actionByTestId(renderer, "laboratory-order-action");
    expect(button.props.disabled).toBe(true);
    expect(renderer.root.findByProps({ testID: "laboratory-command-readiness" }).props.children)
      .toBe("Patsiendi Runtime sünkroniseerib värskeimat kontrollpunkti.");
    await act(async () => { button.props.onPress(); });
    expect(onOrder).not.toHaveBeenCalled();
  });

  test("automatically enables the same ORDER target when command readiness returns", async () => {
    const onOrder = jest.fn(async () => ({ ok: true, message: "ok" }));
    const onCollect = jest.fn(async () => ({ ok: true, message: "ok" }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={empty}
      workflowScopeKey="EX:PT" projectionRevision={80} packageId="NARVA_IRO_ASTRUP"
      commandReadiness={{ ready: false, reason: "syncing" }} onOrder={onOrder} onCollect={onCollect} />); });
    const syncing = actionByTestId(renderer, "laboratory-order-action");
    expect(syncing.props.disabled).toBe(true);
    await act(async () => { renderer.update(<LaboratoryWorkflowCard workflow={empty}
      workflowScopeKey="EX:PT" projectionRevision={80} packageId="NARVA_IRO_ASTRUP"
      commandReadiness={{ ready: true }} onOrder={onOrder} onCollect={onCollect} />); });
    const ready = actionByTestId(renderer, "laboratory-order-action");
    expect(ready).toBe(syncing);
    expect(ready.props.disabled).toBe(false);
    await act(async () => { ready.props.onPress(); });
    expect(onOrder).toHaveBeenCalledTimes(1);
    expect(onCollect).not.toHaveBeenCalled();
  });

  test("keeps COLLECT semantic identity while command readiness is fenced, then enables it", async () => {
    const onOrder = jest.fn(async () => ({ ok: true, message: "ok" }));
    const onCollect = jest.fn(async () => ({ ok: true, message: "ok" }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={processing}
      workflowScopeKey="EX:PT" projectionRevision={91} packageId="NARVA_IRO_ASTRUP"
      commandReadiness={{ ready: false, reason: "syncing" }} onOrder={onOrder} onCollect={onCollect} />); });
    const syncing = actionByTestId(renderer, "laboratory-collect-action");
    expect(syncing.props.disabled).toBe(true);
    expect(actionsByTestId(renderer, "laboratory-order-action")).toHaveLength(0);
    await act(async () => { syncing.props.onPress(); });
    expect(onOrder).not.toHaveBeenCalled();
    expect(onCollect).not.toHaveBeenCalled();
    await act(async () => { renderer.update(<LaboratoryWorkflowCard workflow={processing}
      workflowScopeKey="EX:PT" projectionRevision={92} packageId="NARVA_IRO_ASTRUP"
      commandReadiness={{ ready: true }} onOrder={onOrder} onCollect={onCollect} />); });
    const ready = actionByTestId(renderer, "laboratory-collect-action");
    expect(ready).toBe(syncing);
    expect(ready.props.disabled).toBe(false);
    expect(actionsByTestId(renderer, "laboratory-order-action")).toHaveLength(0);
    await act(async () => { ready.props.onPress(); });
    expect(onCollect).toHaveBeenCalledTimes(1);
    expect(onCollect).toHaveBeenCalledWith("ORDER-1");
    expect(onOrder).not.toHaveBeenCalled();
  });

  test("explicitly aborts an in-progress action if shared command readiness becomes unsafe", async () => {
    const onOrder = jest.fn(async () => ({ ok: true, message: "ok" }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={empty}
      workflowScopeKey="EX:PT" projectionRevision={100} packageId="NARVA_IRO_ASTRUP"
      commandReadiness={{ ready: true }} onOrder={onOrder} onCollect={jest.fn()} />); });
    const target = actionByTestId(renderer, "laboratory-order-action");
    await act(async () => { target.props.onPressIn(); });
    await act(async () => { renderer.update(<LaboratoryWorkflowCard workflow={empty}
      workflowScopeKey="EX:PT" projectionRevision={100} packageId="NARVA_IRO_ASTRUP"
      commandReadiness={{ ready: false, reason: "newer authoritative checkpoint pending" }}
      onOrder={onOrder} onCollect={jest.fn()} />); });
    const activeTarget = actionByTestId(renderer, "laboratory-order-action");
    expect(activeTarget).toBe(target);
    expect(activeTarget.props.disabled).toBe(false);
    await act(async () => { activeTarget.props.onPress(); activeTarget.props.onPressOut(); });
    expect(onOrder).not.toHaveBeenCalled();
  });

  test("traces one stable physical target across press-in, rerenders and dispatch", async () => {
    const previousRelease = process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT;
    const previousHarness = process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS;
    process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT = "production";
    process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS = "1";
    clearLaboratoryActionTraceForValidation();
    const onOrder = jest.fn(async () => ({ ok: true, message: "ok" }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={empty}
      workflowScopeKey="EX:PT" projectionRevision={90} packageId="NARVA_IRO_ASTRUP"
      onOrder={onOrder} onCollect={jest.fn()} />); });
    const target = actionByTestId(renderer, "laboratory-order-action");
    await act(async () => { target.props.onPressIn(); });
    for (let revision = 91; revision <= 93; revision += 1) {
      await act(async () => { renderer.update(<LaboratoryWorkflowCard workflow={empty}
        workflowScopeKey="EX:PT" projectionRevision={revision} packageId="NARVA_IRO_ASTRUP"
        onOrder={onOrder} onCollect={jest.fn()} />); });
      expect(actionByTestId(renderer, "laboratory-order-action")).toBe(target);
    }
    await act(async () => { target.props.onPress(); target.props.onPressOut(); });
    const trace = getLaboratoryActionTrace();
    expect(trace.filter(event => event.event === "LAB_ACTION_MOUNT")).toHaveLength(1);
    expect(trace.filter(event => event.event === "LAB_ACTION_UNMOUNT")).toHaveLength(0);
    expect(trace.filter(event => event.event === "LAB_ACTION_PRESS_IN")).toHaveLength(1);
    expect(trace.filter(event => event.event === "LAB_ACTION_PRESS")).toHaveLength(1);
    expect(new Set(trace.map(event => event.detail.controlInstanceId)).size).toBe(1);
    expect(onOrder).toHaveBeenCalledTimes(1);
    process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT = previousRelease;
    process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS = previousHarness;
  });

  test("keeps COLLECT action identity stable during checkpoint rehydration", async () => {
    const onCollect = jest.fn(async () => ({ ok: true, message: "ok" }));
    const onOrder = jest.fn(async () => ({ ok: true, message: "ok" }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={processing}
      packageId="NARVA_IRO_ASTRUP" onOrder={onOrder} onCollect={onCollect} />); });
    const before = actionByTestId(renderer, "laboratory-collect-action");
    const press = before.props.onPress;
    const rehydrated = Object.freeze({ ...processing, patientBloodIdentities: Object.freeze({}) });
    await act(async () => { renderer.update(<LaboratoryWorkflowCard workflow={rehydrated}
      packageId="NARVA_IRO_ASTRUP" onOrder={onOrder} onCollect={onCollect} />); });
    const after = actionByTestId(renderer, "laboratory-collect-action");
    expect(after).toBe(before);
    expect(after.props.onPress).toBe(press);
    await act(async () => { press(); press(); });
    expect(onCollect).toHaveBeenCalledTimes(1);
    expect(onOrder).not.toHaveBeenCalled();
  });

  test("latches COLLECT at press-in and ignores an older ORDER-like projection before release", async () => {
    const onCollect = jest.fn(async () => ({ ok: true, message: "ok" }));
    const onOrder = jest.fn(async () => ({ ok: true, message: "ok" }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={processing}
      workflowScopeKey="EX:PT" projectionRevision={12} packageId="NARVA_IRO_ASTRUP"
      onOrder={onOrder} onCollect={onCollect} />); });
    const collectAtPressIn = actionByTestId(renderer, "laboratory-collect-action");
    await act(async () => { collectAtPressIn.props.onPressIn(); });
    await act(async () => { renderer.update(<LaboratoryWorkflowCard workflow={empty}
      workflowScopeKey="EX:PT" projectionRevision={11} packageId="NARVA_IRO_ASTRUP"
      onOrder={onOrder} onCollect={onCollect} />); });
    const actionAtRelease = actionByTestId(renderer, "laboratory-collect-action");
    await act(async () => { actionAtRelease.props.onPress(); actionAtRelease.props.onPressOut(); });
    expect(onCollect).toHaveBeenCalledTimes(1);
    expect(onCollect).toHaveBeenCalledWith("ORDER-1");
    expect(onOrder).not.toHaveBeenCalled();
  });

  test("never substitutes COLLECT when an ORDER gesture is invalidated by newer state", async () => {
    const onCollect = jest.fn(async () => ({ ok: true, message: "ok" }));
    const onOrder = jest.fn(async () => ({ ok: true, message: "ok" }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={empty}
      workflowScopeKey="EX:PT" projectionRevision={20} packageId="NARVA_IRO_ASTRUP"
      onOrder={onOrder} onCollect={onCollect} />); });
    const orderAtPressIn = actionByTestId(renderer, "laboratory-order-action");
    await act(async () => { orderAtPressIn.props.onPressIn(); });
    await act(async () => { renderer.update(<LaboratoryWorkflowCard workflow={processing}
      workflowScopeKey="EX:PT" projectionRevision={21} packageId="NARVA_IRO_ASTRUP"
      onOrder={onOrder} onCollect={onCollect} />); });
    const actionAtRelease = actionByTestId(renderer, "laboratory-order-action");
    await act(async () => { actionAtRelease.props.onPress(); actionAtRelease.props.onPressOut(); });
    expect(onOrder).not.toHaveBeenCalled();
    expect(onCollect).not.toHaveBeenCalled();
  });

  test("aborts invalidated COLLECT instead of substituting ORDER", async () => {
    const onCollect = jest.fn(async () => ({ ok: true, message: "ok" }));
    const onOrder = jest.fn(async () => ({ ok: true, message: "ok" }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={processing}
      workflowScopeKey="EX:PT" projectionRevision={30} packageId="NARVA_IRO_ASTRUP"
      onOrder={onOrder} onCollect={onCollect} />); });
    const collectAtPressIn = actionByTestId(renderer, "laboratory-collect-action");
    await act(async () => { collectAtPressIn.props.onPressIn(); });
    await act(async () => { renderer.update(<LaboratoryWorkflowCard workflow={resulted}
      workflowScopeKey="EX:PT" projectionRevision={31} packageId="NARVA_IRO_ASTRUP"
      onOrder={onOrder} onCollect={onCollect} />); });
    const actionAtRelease = actionByTestId(renderer, "laboratory-collect-action");
    await act(async () => { actionAtRelease.props.onPress(); actionAtRelease.props.onPressOut(); });
    expect(onCollect).not.toHaveBeenCalled();
    expect(onOrder).not.toHaveBeenCalled();
  });

  test("submits one valid ORDER when readiness temporarily drops during the gesture", async () => {
    const onOrder = jest.fn(async () => ({ ok: true, message: "ok" }));
    const onCollect = jest.fn(async () => ({ ok: true, message: "ok" }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={empty}
      workflowScopeKey="EX:PT" projectionRevision={60} packageId="NARVA_IRO_ASTRUP"
      onOrder={onOrder} onCollect={onCollect} />); });
    const orderAtPressIn = actionByTestId(renderer, "laboratory-order-action");
    await act(async () => { orderAtPressIn.props.onPressIn(); });
    await act(async () => { renderer.update(<LaboratoryWorkflowCard workflow={empty}
      workflowScopeKey="EX:PT" projectionRevision={60} projectionReady={false}
      packageId="NARVA_IRO_ASTRUP" onOrder={onOrder} onCollect={onCollect} />); });
    const orderAtRelease = actionByTestId(renderer, "laboratory-order-action");
    await act(async () => { orderAtRelease.props.onPress(); orderAtRelease.props.onPressOut(); });
    expect(onOrder).toHaveBeenCalledTimes(1);
    expect(onCollect).not.toHaveBeenCalled();
  });

  test("submits one valid COLLECT across transient readiness loss and repeated rerenders", async () => {
    const onCollect = jest.fn(async () => ({ ok: true, message: "ok" }));
    const onOrder = jest.fn(async () => ({ ok: true, message: "ok" }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={processing}
      workflowScopeKey="EX:PT" projectionRevision={70} packageId="NARVA_IRO_ASTRUP"
      onOrder={onOrder} onCollect={onCollect} />); });
    const collectAtPressIn = actionByTestId(renderer, "laboratory-collect-action");
    await act(async () => { collectAtPressIn.props.onPressIn(); });
    for (let index = 0; index < 3; index += 1) {
      await act(async () => { renderer.update(<LaboratoryWorkflowCard workflow={empty}
        workflowScopeKey="EX:PT" projectionRevision={69 - index} projectionReady={false}
        packageId="NARVA_IRO_ASTRUP" onOrder={onOrder} onCollect={onCollect} />); });
      expect(actionsByTestId(renderer, "laboratory-collect-action")).toHaveLength(1);
      expect(actionsByTestId(renderer, "laboratory-order-action")).toHaveLength(0);
    }
    const collectAtRelease = actionByTestId(renderer, "laboratory-collect-action");
    await act(async () => { collectAtRelease.props.onPress(); collectAtRelease.props.onPressOut(); });
    expect(onCollect).toHaveBeenCalledTimes(1);
    expect(onCollect).toHaveBeenCalledWith("ORDER-1");
    expect(onOrder).not.toHaveBeenCalled();
  });

  test("keeps a newer collectable projection when an older empty projection arrives", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={processing}
      workflowScopeKey="EX:PT" projectionRevision={42} packageId="NARVA_IRO_ASTRUP"
      onOrder={jest.fn()} onCollect={jest.fn()} />); });
    await act(async () => { renderer.update(<LaboratoryWorkflowCard workflow={empty}
      workflowScopeKey="EX:PT" projectionRevision={41} packageId="NARVA_IRO_ASTRUP"
      onOrder={jest.fn()} onCollect={jest.fn()} />); });
    expect(actionsByTestId(renderer, "laboratory-collect-action")).toHaveLength(1);
    expect(actionsByTestId(renderer, "laboratory-order-action")).toHaveLength(0);
  });

  test("accepts legitimate newer sample confirmation and terminal invalidation", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={processing}
      workflowScopeKey="EX:PT" projectionRevision={50} packageId="NARVA_IRO_ASTRUP"
      onOrder={jest.fn()} onCollect={jest.fn()} />); });
    await act(async () => { renderer.update(<LaboratoryWorkflowCard workflow={resulted}
      workflowScopeKey="EX:PT" projectionRevision={51} packageId="NARVA_IRO_ASTRUP"
      onOrder={jest.fn()} onCollect={jest.fn()} />); });
    expect(actionsByTestId(renderer, "laboratory-collect-action")).toHaveLength(0);
    expect(actionsByTestId(renderer, "laboratory-order-action")).toHaveLength(1);
    await act(async () => { renderer.update(<LaboratoryWorkflowCard workflow={resulted} readOnly
      workflowScopeKey="EX:PT" projectionRevision={52} packageId="NARVA_IRO_ASTRUP"
      onOrder={jest.fn()} onCollect={jest.fn()} />); });
    expect(renderer.root.findAllByType("Pressable" as never)).toHaveLength(0);
  });

  test("clears ORDER pending after durable failure and permits retry", async () => {
    const onOrder = jest.fn(async () => ({ ok: false, message: "failed" }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard packageId="NARVA_IRO_ASTRUP"
      onOrder={onOrder} onCollect={jest.fn()} />); });
    const button = actionByTestId(renderer, "laboratory-order-action");
    await act(async () => { button.props.onPress(); });
    await act(async () => { button.props.onPress(); });
    expect(onOrder).toHaveBeenCalledTimes(2);
  });

  test("clears COLLECT pending after durable failure and permits retry", async () => {
    const onCollect = jest.fn(async () => ({ ok: false, message: "failed" }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={processing}
      packageId="NARVA_IRO_ASTRUP" onOrder={jest.fn()} onCollect={onCollect} />); });
    const button = actionByTestId(renderer, "laboratory-collect-action");
    await act(async () => { button.props.onPress(); });
    await act(async () => { button.props.onPress(); });
    expect(onCollect).toHaveBeenCalledTimes(2);
  });

  test("renders authoritative sample time, availability, generator and result values", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={resulted}
      packageId="NARVA_IRO_ASTRUP" onOrder={jest.fn()} onCollect={jest.fn()} />); });
    const text = renderer.root.findAllByType("Text" as never).map(node => node.props.children).flat(Infinity)
      .join(" ").replace(/\s+/g, " ");
    const compact = text.replace(/\s/g, "");
    expect(compact).toContain("sampledAtT+100s");
    expect(compact).toContain("availableAtT+1600s");
    expect(text).toContain("narva-lab-physiology-v1");
    expect(compact).toContain("pH:7.12");
    expect(compact).toContain("Ionizedcalcium:0.91mmol/L");
  });

  test("read-only/terminal presentation exposes no order or collection action", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<LaboratoryWorkflowCard workflow={processing}
      packageId="NARVA_IRO_ASTRUP" readOnly onOrder={jest.fn()} onCollect={jest.fn()} />); });
    expect(renderer.root.findAllByType("Pressable" as never)).toHaveLength(0);
  });
});
