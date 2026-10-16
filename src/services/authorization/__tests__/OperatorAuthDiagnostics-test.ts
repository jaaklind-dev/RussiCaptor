import { classifyOperatorAuthFailure, recordOperatorAuthDiagnostic } from "../OperatorAuthDiagnostics";

describe("operator authentication diagnostics", () => {
  test("classifies transport, service, and unexpected failures without recording raw errors", () => {
    expect(classifyOperatorAuthFailure({ name: "AuthRetryableFetchError", message: "private-token" })).toBe("NETWORK");
    expect(classifyOperatorAuthFailure({ status: 503, message: "private-token" })).toBe("SERVICE_ERROR");
    expect(classifyOperatorAuthFailure(new Error("private-token"))).toBe("UNEXPECTED");
    const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      recordOperatorAuthDiagnostic("SESSION_RESTORE", "NETWORK");
      expect(warning).toHaveBeenCalledWith("OPERATOR_AUTH_DIAGNOSTIC",
        { stage: "SESSION_RESTORE", reason: "NETWORK" });
      expect(JSON.stringify(warning.mock.calls)).not.toContain("private-token");
    } finally { warning.mockRestore(); }
  });

  test("a diagnostic logger failure cannot change the authorization outcome", () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => { throw new Error("logger unavailable"); });
    try { expect(() => recordOperatorAuthDiagnostic("ROLE_LOOKUP", "NETWORK")).not.toThrow(); }
    finally { warning.mockRestore(); }
  });
});
