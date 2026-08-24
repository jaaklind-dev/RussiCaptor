import { notifySync } from "@/services/SyncService";
import {
  clearPatientTransportRuntime,
  preparePatientTransportRuntime,
  startPatientTransport,
} from "../PatientTransportRuntimeService";

const mockStart = jest.fn();

jest.mock("@/services/SyncService", () => ({ notifySync: jest.fn() }));
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
  afterEach(() => { clearPatientTransportRuntime(); jest.clearAllMocks(); });

  test("a newly started transport immediately requests canonical persistence", () => {
    mockStart.mockReturnValue({ status: "STARTED", transport: { transportId: "T1" } });
    preparePatientTransportRuntime("EX");

    expect(startPatientTransport("C1", "P01", "R1", "D1")).toMatchObject({ status: "STARTED" });
    expect(mockNotifySync).toHaveBeenCalledTimes(1);
    expect(mockNotifySync).toHaveBeenCalledWith("local");
  });

  test("a rejected request does not publish a new checkpoint generation", () => {
    mockStart.mockReturnValue({ status: "REJECTED", reason: "TRANSPORT_RESOURCE_BUSY" });
    preparePatientTransportRuntime("EX");

    expect(startPatientTransport("C2", "P01", "R1", "D1")).toMatchObject({ status: "REJECTED" });
    expect(mockNotifySync).not.toHaveBeenCalled();
  });
});
