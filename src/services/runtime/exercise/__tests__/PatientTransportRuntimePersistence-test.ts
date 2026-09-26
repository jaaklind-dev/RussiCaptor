import { notifySync } from "@/services/SyncService";
import {
  clearPatientTransportRuntime,
  preparePatientTransportRuntime,
  materializePatientTransport,
  submitPatientTransport,
} from "../PatientTransportRuntimeService";

const mockStart = jest.fn();
const mockGetCommandGateway = jest.fn();
const mockSubmitCommand = jest.fn();
const mockWaitForCommandResult = jest.fn();
const mockReadiness = jest.fn();

jest.mock("@/services/SyncService", () => ({ notifySync: jest.fn() }));
jest.mock("@/services/runtime/commands/RuntimePatientCommandService", () => ({
  runtimePatientCommandSubmissionReadiness: (...args: unknown[]) => mockReadiness(...args),
  submitPatientRuntimeCommand: (...args: unknown[]) => mockSubmitCommand(...args),
  waitForPatientRuntimeCommandResult: (...args: unknown[]) => mockWaitForCommandResult(...args),
}));
jest.mock("@/providers/ProviderFactory", () => ({
  dataProvider: { getPatients: () => [{ id: "P01", location: "ED" }], setPatientLocation: jest.fn() },
}));
jest.mock("@/repositories/ExerciseSessionRepository", () => ({
  getCanonicalExerciseSnapshot: () => ({ exerciseId: "EX", simulationTimeSec: 10 }),
}));
jest.mock("@/repositories/TimelineRepository", () => ({ addTimelineEvent: jest.fn() }));
jest.mock("@/services/exercise/ExercisePackageService", () => ({
  getExercisePackage: () => ({ transportConfiguration: { version: "1.0.0", resources: [], destinations: [] } }),
}));
jest.mock("@/services/runtime/PatientTransportEngine", () => ({
  PatientTransportEngine: jest.fn().mockImplementation(() => ({
    start: mockStart,
    advanceTo: jest.fn(),
    snapshot: () => ({ patientLocations: { P01: "ED" }, evidence: [] }),
  })),
}));
jest.mock("../ExerciseClockTargetRegistry", () => ({ registerExerciseClockTarget: () => jest.fn() }));

const mockNotifySync = notifySync as jest.MockedFunction<typeof notifySync>;

describe("WP-45C transport persistence boundary", () => {
  beforeEach(() => { mockGetCommandGateway.mockReturnValue(undefined); mockReadiness.mockReturnValue({ ready: true }); mockWaitForCommandResult.mockResolvedValue(undefined); });
  afterEach(() => { clearPatientTransportRuntime(); jest.clearAllMocks(); });

  test("a newly started transport immediately requests canonical persistence", () => {
    mockStart.mockReturnValue({ status: "STARTED", transport: { transportId: "T1" } });
    preparePatientTransportRuntime("EX");

    expect(materializePatientTransport("C1", "P01", "R1", "D1", 10)).toMatchObject({ status: "STARTED" });
    expect(mockNotifySync).toHaveBeenCalledTimes(1);
    expect(mockNotifySync).toHaveBeenCalledWith("local");
  });

  test("a rejected request does not publish a new checkpoint generation", () => {
    mockStart.mockReturnValue({ status: "REJECTED", reason: "TRANSPORT_RESOURCE_BUSY" });
    preparePatientTransportRuntime("EX");

    expect(materializePatientTransport("C2", "P01", "R1", "D1", 10)).toMatchObject({ status: "REJECTED" });
    expect(mockNotifySync).not.toHaveBeenCalled();
  });

  test("a non-writer submission stays pending and does not create local transport state", async () => {
    mockGetCommandGateway.mockReturnValue({});
    mockSubmitCommand.mockResolvedValue({ status: "APPLIED", commandSequence: 7, patientRevision: 3 });
    preparePatientTransportRuntime("EX");

    await expect(submitPatientTransport("REMOTE-1", "P01", "R1", "D1"))
      .resolves.toEqual({ status: "PENDING", commandId: "REMOTE-1" });
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockSubmitCommand).toHaveBeenCalledWith(expect.objectContaining({ commandType: "TRANSPORT_START",
      simulationTimeSec: 10, payload: { resourceId: "R1", destinationId: "D1" } }));
    expect(mockWaitForCommandResult).toHaveBeenCalledWith("EX", 7);
    expect(mockNotifySync).not.toHaveBeenCalled();
  });

  test("an authoritative materialization rejection clears pending with its transport reason", async () => {
    mockGetCommandGateway.mockReturnValue({});
    mockSubmitCommand.mockResolvedValue({ status: "APPLIED", commandSequence: 8, patientRevision: 3 });
    mockWaitForCommandResult.mockResolvedValue({ status: "REJECTED", result: { reason: "TRANSPORT_RESOURCE_BUSY" } });
    preparePatientTransportRuntime("EX");

    await expect(submitPatientTransport("REMOTE-3", "P01", "R1", "D1"))
      .resolves.toEqual({ status: "REJECTED", commandId: "REMOTE-3", reason: "TRANSPORT_RESOURCE_BUSY" });
    expect(mockStart).not.toHaveBeenCalled();
  });

  test("a failed durable submission clears the pending contract without local mutation", async () => {
    mockGetCommandGateway.mockReturnValue({});
    mockSubmitCommand.mockResolvedValue({ status: "COMPLETION_FENCED", patientRevision: 3 });
    preparePatientTransportRuntime("EX");

    await expect(submitPatientTransport("REMOTE-2", "P01", "R1", "D1"))
      .resolves.toEqual({ status: "REJECTED", commandId: "REMOTE-2", reason: "COMPLETION_FENCED" });
    expect(mockStart).not.toHaveBeenCalled();
  });

  test("missing gateway/readiness fails closed without falling back to the local owner", async () => {
    mockReadiness.mockReturnValue({ ready: false, reason: "Patsiendi käskude saatmine ei ole ühendatud." });
    preparePatientTransportRuntime("EX");

    await expect(submitPatientTransport("NO-GATEWAY", "P01", "R1", "D1")).resolves.toEqual({
      status: "REJECTED", commandId: "NO-GATEWAY", reason: "Patsiendi käskude saatmine ei ole ühendatud.",
    });
    expect(mockSubmitCommand).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockNotifySync).not.toHaveBeenCalled();
  });
});
