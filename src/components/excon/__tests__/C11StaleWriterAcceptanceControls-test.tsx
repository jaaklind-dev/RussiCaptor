import TestRenderer, { act } from "react-test-renderer";

import C11StaleWriterAcceptanceControls from "../C11StaleWriterAcceptanceControls";

let mockAuthority = "READER";
let mockEnabled = true;
let mockCaptured: { exerciseId: string; writerGeneration: number; operationId: string; sent: boolean } | undefined;
const mockListeners = new Set<() => void>();
const mockCapture = jest.fn(async () => {
  mockCaptured = { exerciseId: "EX-TEST", writerGeneration: 1, operationId: "OP-A", sent: false };
  return { code: "CAPTURED" };
});
const mockSend = jest.fn(async () => ({ code: "WRITER_GENERATION_STALE", httpStatus: 403 }));

jest.mock("@/services/runtime/persistence/C11StaleWriterAcceptanceProbe", () => ({
  isC11StaleWriterProbeEnabled: () => mockEnabled,
  getC11StaleWriterProbeCapture: () => mockCaptured,
  captureC11StaleWriterProbe: () => mockCapture(),
  sendC11StaleWriterProbe: () => mockSend(),
}));
jest.mock("@/services/runtime/persistence/RuntimeWriterAuthorityState", () => ({
  getRuntimeWriterAuthorityState: () => mockAuthority,
}));
jest.mock("@/services/RuntimeCheckpointSyncService", () => ({
  subscribeToRuntimeCheckpointSync: (listener: () => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
}));

function button(renderer: TestRenderer.ReactTestRenderer): TestRenderer.ReactTestInstance {
  return renderer.root.findAllByProps({ accessibilityRole: "button" })[0];
}

beforeEach(() => {
  mockAuthority = "READER";
  mockEnabled = true;
  mockCaptured = undefined;
  mockListeners.clear();
  mockCapture.mockClear();
  mockSend.mockClear();
});

describe("C11 acceptance-only writer capture control", () => {
  test("enables on the mounted workboard after A becomes writer and can capture its context", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<C11StaleWriterAcceptanceControls />); });
    expect(button(renderer).props.disabled).toBe(true);

    // The app publishes while this control is already mounted; no route remount is required.
    await act(async () => {
      mockAuthority = "WRITER";
      mockListeners.forEach(listener => listener());
    });
    expect(button(renderer).props.disabled).toBe(false);

    await act(async () => { button(renderer).props.onPress(); });
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCaptured).toMatchObject({ exerciseId: "EX-TEST", writerGeneration: 1, operationId: "OP-A" });
    expect(button(renderer).props.disabled).toBe(false);
  });

  test("keeps the captured A generation and explicit send available after B takes over", async () => {
    mockAuthority = "WRITER";
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<C11StaleWriterAcceptanceControls />); });
    await act(async () => { button(renderer).props.onPress(); });
    await act(async () => {
      mockAuthority = "READER";
      mockListeners.forEach(listener => listener());
    });
    expect(mockCaptured?.writerGeneration).toBe(1);
    expect(button(renderer).props.disabled).toBe(false);
    await act(async () => { button(renderer).props.onPress(); });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test("renders no probe in production builds", async () => {
    mockEnabled = false;
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<C11StaleWriterAcceptanceControls />); });
    expect(renderer.toJSON()).toBeNull();
    expect(mockListeners.size).toBe(0);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
