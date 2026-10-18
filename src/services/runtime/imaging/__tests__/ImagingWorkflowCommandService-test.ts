import { submitImagingOrder } from "../ImagingWorkflowCommandService";
import { submitPatientRuntimeCommand } from "@/services/runtime/commands/RuntimePatientCommandService";
import { imagingOrderPresentation, resetImagingOrderReceipts } from "../ImagingOrderPresentation";
import type { Order } from "@/models/Order";

jest.mock("@/services/runtime/commands/RuntimePatientCommandService", () => ({
  submitPatientRuntimeCommand: jest.fn(),
}));

describe("I2 Imaging durable command facade", () => {
  beforeEach(() => { jest.clearAllMocks(); resetImagingOrderReceipts(); });
  test("routes orders only through the durable patient command path", async () => {
    const submit = submitPatientRuntimeCommand as jest.MockedFunction<typeof submitPatientRuntimeCommand>;
    submit.mockResolvedValue({ status: "APPLIED", patientRevision: 2 });
    await submitImagingOrder("EX", "P09", "P09-CXR", "CMD-I2");
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ exerciseId: "EX", patientId: "P09",
      commandId: "CMD-I2", commandType: "IMAGING_ORDER", payload: { definitionId: "P09-CXR" } }));
  });
  test.each(["APPLIED", "IDEMPOTENT"] as const)("%s supplies a pending transport receipt, not a local clinical result", async status => {
    jest.mocked(submitPatientRuntimeCommand).mockResolvedValue({ status, patientRevision: 2 });
    await submitImagingOrder("EX", "P09", "P09-CXR", "CMD-I2");
    const order = { exerciseId: "EX", patientId: "P09", workflow: { resultTargetId: "P09-CXR" } } as Order;
    expect(imagingOrderPresentation(order, { schemaVersion: 2, instances: [] }))
      .toMatchObject({ status: "PENDING", pending: true, repeat: true });
  });
  test.each(["RECONNECT_REQUIRED", "NOT_OWNER", "EXERCISE_NOT_ACTIVE", "UNAVAILABLE"] as const)(
    "%s never fabricates acceptance", async status => {
      jest.mocked(submitPatientRuntimeCommand).mockResolvedValue({ status, patientRevision: 2 });
      await submitImagingOrder("EX", "P09", "P09-CXR", "CMD-I2");
      const order = { exerciseId: "EX", patientId: "P09", workflow: { resultTargetId: "P09-CXR" } } as Order;
      expect(imagingOrderPresentation(order, { schemaVersion: 2, instances: [] }))
        .toMatchObject({ status: "NOT_ORDERED", pending: false, repeat: false });
    });
});
