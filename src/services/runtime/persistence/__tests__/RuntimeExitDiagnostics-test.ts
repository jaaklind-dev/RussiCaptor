import { getRuntimeExitDiagnostics, recordRuntimeExitFailure } from "../RuntimeExitDiagnostics";

describe("bounded operational runtime-exit failure evidence", () => {
  test("retains only an allowlisted reason and stage, never raw messages or causes", () => {
    recordRuntimeExitFailure("LEASE_RELEASE", new Error("STALE_WRITER"));
    expect(getRuntimeExitDiagnostics().at(-1)).toMatchObject({ stage: "LEASE_RELEASE", reason: "STALE_WRITER", errorKind: "ERROR" });
    const error = new Error("password=private-secret token=private-token patient=private-payload", { cause: new Error("nested-private") });
    recordRuntimeExitFailure("PUBLICATION", error);
    const last = getRuntimeExitDiagnostics().at(-1);
    expect(last).toMatchObject({ reason: "UNCLASSIFIED_ERROR", errorKind: "ERROR" });
    expect(JSON.stringify(last)).not.toMatch(/private|nested|password|token|patient|stack|cause/);
  });

  test("distinguishes TypeError and non-Error without copying their values", () => {
    recordRuntimeExitFailure("PUBLICATION", new TypeError("private"));
    expect(getRuntimeExitDiagnostics().at(-1)?.errorKind).toBe("TYPE_ERROR");
    recordRuntimeExitFailure("PUBLICATION", { message: "STALE_WRITER", token: "private" });
    expect(getRuntimeExitDiagnostics().at(-1)).toMatchObject({ reason: "UNCLASSIFIED_ERROR", errorKind: "NON_ERROR" });
  });

  test("retains at most eight immutable payload-free events", () => {
    for (let n = 0; n < 12; n++) recordRuntimeExitFailure("PUBLICATION_DRAIN", new Error("WRITER_SIGNOUT_PUBLICATION_UNSETTLED"));
    const events = getRuntimeExitDiagnostics();
    expect(events).toHaveLength(8);
    expect(Object.isFrozen(events)).toBe(true);
    expect(events.every(Object.isFrozen)).toBe(true);
    expect(Object.keys(events[0]).sort()).toEqual(["atMs", "errorKind", "reason", "stage"]);
  });
});
