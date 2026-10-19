import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Alert, Pressable, Share } from "react-native";
import SharedWorkflowValidationCard from "../SharedWorkflowValidationCard";
import * as harness from "@/services/sharedWorkflow/PhysicalValidationHarnessService";

jest.mock("@/repositories/ExerciseSessionRepository", () => ({ getCanonicalExerciseSnapshot: () => ({ exerciseId: "EX-TEST-1" }) }));
jest.mock("@/services/AssignmentRepository", () => ({ releasePatientConflictSafe: jest.fn() }));
jest.mock("@/services/sharedWorkflow/SharedWorkflowMutationService", () => ({
  getSharedWorkflowOperationalState: () => ({ online: true, realtimeLifecycle: "SUBSCRIBED" }),
  subscribeToSharedWorkflowConflicts: () => () => {},
}));
jest.mock("@/services/sharedWorkflow/PhysicalValidationHarnessService", () => ({
  armPhysicalValidationHarness: jest.fn(() => true), disarmPhysicalValidationHarness: jest.fn(),
  isPhysicalValidationContextArmed: () => true, getPhysicalValidationEvidence: jest.fn(() => []),
  canArmPhysicalValidationHarness: jest.fn(() => true), subscribePhysicalValidationContext: () => () => {},
  getPreparedValidationAvailability: jest.fn(() => ({ normal: true, negative: false })),
  submitNegativePhysicalValidationMutation: jest.fn(),
  prepareValidationClaim: jest.fn(), prepareSameBaseAppendPair: jest.fn(),
  prepareSameBaseMutableMutation: jest.fn(), prepareStaleFormerOwnerMutation: jest.fn(),
  submitPreparedPhysicalValidationMutation: jest.fn(),
}));
const prepared = (commandId: string): harness.PreparedPhysicalValidationMutation => Object.freeze({
  exerciseId: "EX-TEST-1", patientId: "PT-PELVIC-001", operatorId: "CM-A", sessionGeneration: 1,
  contextId: "CTX", commandId, kind: "APPEND", expectedRevision: 7, expectedOwnerUserId: "CM-A",
});
const button = (r: TestRenderer.ReactTestRenderer, label: string) => r.root.findAllByProps({ accessibilityLabel: label }).find(n => typeof n.props.onPress === "function")!;
describe("physical validation controls", () => {
  let renderer: TestRenderer.ReactTestRenderer;
  beforeEach(() => { jest.clearAllMocks(); jest.mocked(harness.getPreparedValidationAvailability).mockReturnValue({ normal: true, negative: false }); jest.spyOn(Alert, "alert").mockImplementation(() => {}); });
  afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); jest.restoreAllMocks(); });
  test("arming requires explicit confirmation; preparation never submits", async () => {
    await act(async () => { renderer = TestRenderer.create(<SharedWorkflowValidationCard />); });
    await act(async () => button(renderer, "Armeeri TEST: Samsung-A").props.onPress());
    expect(harness.armPhysicalValidationHarness).not.toHaveBeenCalled();
    const confirm = jest.mocked(Alert.alert).mock.calls[0][2]!.find(b => b.text === "Kinnitan TEST")!;
    await act(async () => confirm.onPress!()); expect(harness.armPhysicalValidationHarness).toHaveBeenCalledWith("Samsung-A");
    jest.mocked(harness.prepareSameBaseAppendPair).mockReturnValue([prepared("CMD-1"), prepared("CMD-2")]);
    await act(async () => button(renderer, "Valmista sama baasiga APPEND-paar").props.onPress());
    expect(harness.submitPreparedPhysicalValidationMutation).not.toHaveBeenCalled();
    expect(button(renderer, "Saada valmiskäsk 1")).toBeDefined(); expect(button(renderer, "Saada valmiskäsk 2")).toBeDefined();
    let finish!: (value: harness.PhysicalValidationOutcome) => void;
    jest.mocked(harness.submitPreparedPhysicalValidationMutation).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const send = button(renderer, "Saada valmiskäsk 1");
    await act(async () => { send.props.onPress(); send.props.onPress(); });
    expect(harness.submitPreparedPhysicalValidationMutation).toHaveBeenCalledTimes(1);
    expect(harness.submitPreparedPhysicalValidationMutation).toHaveBeenCalledWith(prepared("CMD-1"));
    await act(async () => finish({ result: { status: "APPLIED", revision: 8 }, message: "ok" }));
  });
  test("read-only handlers cannot arm, prepare or send; unmount disarms", async () => {
    await act(async () => { renderer = TestRenderer.create(<SharedWorkflowValidationCard readOnly />); });
    await act(async () => { button(renderer, "Armeeri TEST: Samsung-A").props.onPress(); button(renderer, "Valmista sama baasiga APPEND-paar").props.onPress(); });
    expect(Alert.alert).not.toHaveBeenCalled(); expect(harness.prepareSameBaseAppendPair).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType(Pressable).every(n => n.props.disabled)).toBe(true);
    await act(async () => renderer.unmount()); expect(harness.disarmPhysicalValidationHarness).toHaveBeenCalled();
  });
  test("prepared controls become terminal-disabled and old handlers cannot send", async () => {
    jest.mocked(harness.prepareSameBaseAppendPair).mockReturnValue([prepared("CMD-1"), prepared("CMD-2")]);
    await act(async () => { renderer = TestRenderer.create(<SharedWorkflowValidationCard />); });
    await act(async () => button(renderer, "Valmista sama baasiga APPEND-paar").props.onPress());
    const oldSend = button(renderer, "Saada valmiskäsk 1").props.onPress;
    await act(async () => renderer.update(<SharedWorkflowValidationCard readOnly />));
    expect(renderer.root.findAllByType(Pressable).every(n => n.props.disabled)).toBe(true);
    await act(async () => { oldSend(); button(renderer, "Negatiivne TEST-käsk 1").props.onPress(); });
    expect(harness.submitPreparedPhysicalValidationMutation).not.toHaveBeenCalled(); expect(harness.submitNegativePhysicalValidationMutation).not.toHaveBeenCalled();
  });
  test("stale normal control is disabled; negative confirmation can be cancelled or double-activated safely", async () => {
    jest.mocked(harness.prepareSameBaseAppendPair).mockReturnValue([prepared("CMD-1"), prepared("CMD-2")]);
    jest.mocked(harness.getPreparedValidationAvailability).mockReturnValue({ normal: false, negative: true });
    await act(async () => { renderer = TestRenderer.create(<SharedWorkflowValidationCard />); });
    await act(async () => button(renderer, "Valmista sama baasiga APPEND-paar").props.onPress());
    expect(button(renderer, "Saada valmiskäsk 1").props.disabled).toBe(true);
    await act(async () => button(renderer, "Saada valmiskäsk 1").props.onPress());
    expect(harness.submitPreparedPhysicalValidationMutation).not.toHaveBeenCalled();
    await act(async () => button(renderer, "Negatiivne TEST-käsk 1").props.onPress());
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find(b => b.text === "Loobu")?.style).toBe("cancel");
    expect(harness.submitNegativePhysicalValidationMutation).not.toHaveBeenCalled();
    const confirm = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find(b => b.text === "Kinnitan negatiivse TEST-i")!;
    // Context changes while the confirmation is open: no RPC.
    jest.mocked(harness.getPreparedValidationAvailability).mockReturnValue({ normal: false, negative: false });
    await act(async () => confirm.onPress!()); expect(harness.submitNegativePhysicalValidationMutation).not.toHaveBeenCalled();
    jest.mocked(harness.getPreparedValidationAvailability).mockReturnValue({ normal: false, negative: true });
    let finish!: (value: harness.PhysicalValidationOutcome) => void;
    jest.mocked(harness.submitNegativePhysicalValidationMutation).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { confirm.onPress!(); confirm.onPress!(); });
    expect(harness.submitNegativePhysicalValidationMutation).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByType(Pressable).every(n => n.props.disabled)).toBe(true);
    await act(async () => { jest.mocked(harness.getPreparedValidationAvailability).mockReturnValue({ normal: false, negative: false }); finish({ result: { status: "STALE_VERSION", revision: 8 }, message: "ok" }); });
    expect(button(renderer, "Negatiivne TEST-käsk 1").props.disabled).toBe(true);
  });
  test("sharing is explicit and contains only the bounded evidence projection", async () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction });
    await act(async () => { renderer = TestRenderer.create(<SharedWorkflowValidationCard />); });
    expect(share).not.toHaveBeenCalled();
    await act(async () => button(renderer, "Jaga piiratud valideerimistõendit").props.onPress());
    expect(share).toHaveBeenCalledWith({ title: "WP-NEXT-03 TEST", message: "[]" });
  });
});
