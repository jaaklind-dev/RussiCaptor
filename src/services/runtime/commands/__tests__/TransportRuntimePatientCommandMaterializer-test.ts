import type { AcceptedRuntimePatientCommand } from "@/models/RuntimePatientCommand";
import { materializeRuntimePatientCommand } from "../RuntimePatientCommandMaterializer";
import { materializePatientTransport } from "@/services/runtime/exercise/PatientTransportRuntimeService";

jest.mock("@/services/runtime/exercise/PatientTransportRuntimeService", () => ({ materializePatientTransport: jest.fn() }));
jest.mock("@/services/runtime/instructor/ResourceInterventionCommandService", () => ({
  handleResourceInterventionCommand: jest.fn(), stopResourceInterventionCommand: jest.fn(),
}));
jest.mock("@/services/runtime/instructor/MassiveTransfusionCommandService", () => ({ handleMtpCommand: jest.fn() }));
jest.mock("@/services/clinical/ClinicalTreatmentCommandService", () => ({ applyClinicalTreatmentLocally: jest.fn() }));

const mockStart = materializePatientTransport as jest.MockedFunction<typeof materializePatientTransport>;
const command = (payload: Readonly<Record<string, unknown>>): AcceptedRuntimePatientCommand => Object.freeze({
  exerciseId: "EX-NARVA", patientId: "PT-CHEST", commandId: "TRANSPORT-1", commandType: "TRANSPORT_START",
  patientBaseRevision: 4, patientResultingRevision: 5, simulationTimeSec: 120, payload,
  commandSequence: 8, actorUserId: "CM-B",
});

describe("WP-NARVA-09 transport command materialization", () => {
  afterEach(() => jest.clearAllMocks());

  test("the active writer materializes the durable transport with its original identity", () => {
    mockStart.mockReturnValue({ status: "STARTED" });
    expect(materializeRuntimePatientCommand(command({ resourceId: "REANIMOBILE-1", destinationId: "IVKH" })))
      .toEqual({ status: "MATERIALIZED", result: { status: "STARTED" } });
    expect(mockStart).toHaveBeenCalledWith("TRANSPORT-1", "PT-CHEST", "REANIMOBILE-1", "IVKH", 120);
  });

  test("invalid payload and authoritative resource rejection fail closed", () => {
    expect(materializeRuntimePatientCommand(command({ destinationId: "IVKH" })))
      .toEqual({ status: "REJECTED", result: { ok: false, reason: "INVALID_COMMAND_PAYLOAD" } });
    mockStart.mockReturnValue({ status: "REJECTED", reason: "TRANSPORT_RESOURCE_BUSY" });
    expect(materializeRuntimePatientCommand(command({ resourceId: "REANIMOBILE-1", destinationId: "IVKH" })))
      .toEqual({ status: "REJECTED", result: { status: "REJECTED", reason: "TRANSPORT_RESOURCE_BUSY" } });
  });
});
