import { FIELD_TOUCH_TARGET_MIN_DP, SingleFlightActionGate, operatorSafeIssueMessage } from "../InteractionSafety";

describe("WP-NEXT-05 rugged-tablet interaction safety", () => {
  test("double press shares one logical mutation", async () => {
    const gate = new SingleFlightActionGate();
    let calls = 0;
    let resolve!: (value: string) => void;
    const operation = () => { calls += 1; return new Promise<string>((done) => { resolve = done; }); };
    const first = gate.run(operation);
    const second = gate.run(operation);
    await Promise.resolve();
    expect(gate.pending).toBe(true);
    expect(calls).toBe(1);
    resolve("APPLIED");
    await expect(Promise.all([first, second])).resolves.toEqual(["APPLIED", "APPLIED"]);
    expect(gate.pending).toBe(false);
  });

  test("critical targets and conflicts have field-safe presentation", () => {
    expect(FIELD_TOUCH_TARGET_MIN_DP).toBeGreaterThanOrEqual(48);
    expect(operatorSafeIssueMessage("LEASE_CONFLICT")).toContain("teine seade");
    expect(operatorSafeIssueMessage("CHECKPOINT_REVISION_CONFLICT")).not.toContain("CHECKPOINT_");
    expect(operatorSafeIssueMessage("UNKNOWN_INTERNAL_CODE")).not.toContain("UNKNOWN_INTERNAL_CODE");
  });
});
