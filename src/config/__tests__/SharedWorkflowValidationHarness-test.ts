import { isSharedWorkflowValidationHarnessEnabled } from "../SharedWorkflowValidationHarness";

describe("shared workflow validation harness gate", () => {
  it("is disabled unless an explicit production validation artifact enables it", () => {
    expect(isSharedWorkflowValidationHarnessEnabled({ releaseEnvironment: "production" })).toBe(false);
    expect(isSharedWorkflowValidationHarnessEnabled({ releaseEnvironment: "development", enabled: "1" })).toBe(false);
    expect(isSharedWorkflowValidationHarnessEnabled({ releaseEnvironment: "production", enabled: "1" })).toBe(true);
  });
});
