import { submitImagingOrder } from "../ImagingWorkflowCommandService";
import { submitPatientRuntimeCommand } from "@/services/runtime/commands/RuntimePatientCommandService";

jest.mock("@/services/runtime/commands/RuntimePatientCommandService", () => ({
  submitPatientRuntimeCommand: jest.fn(),
}));

describe("I2 Imaging durable command facade", () => {
  test("routes orders only through the durable patient command path", async () => {
    const submit = submitPatientRuntimeCommand as jest.MockedFunction<typeof submitPatientRuntimeCommand>;
    submit.mockResolvedValue({ status: "APPLIED", patientRevision: 2 });
    await submitImagingOrder("EX", "P09", "P09-CXR", "CMD-I2");
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ exerciseId: "EX", patientId: "P09",
      commandId: "CMD-I2", commandType: "IMAGING_ORDER", payload: { definitionId: "P09-CXR" } }));
  });
});
