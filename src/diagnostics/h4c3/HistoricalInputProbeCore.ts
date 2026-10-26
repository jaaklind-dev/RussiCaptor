export type H4Case = Readonly<{ id: string; alias?: string; expected: "HISTORICAL_CHECKPOINT_QUARANTINED" | "FALSE"; run: () => unknown | Promise<unknown> }>;
export type H4CaseResult = Readonly<{ id: string; alias?: string; expected: H4Case["expected"]; actual: string; status: "PASS" | "BLOCKED"; stateUnchanged: boolean }>;
export type H4Report = Readonly<{ version: "H4C3-DIAG187-V1"; at: string; status: "PASS" | "BLOCKED"; reason?: string; fixtureSha256: string; beforeDigest: string; afterDigest: string; cases: readonly H4CaseResult[] }>;

/** No file, role, SQL, transport, lease, or retry capability is accepted here. */
export async function executeH4Cases(fixtureSha256: string, fingerprint: () => string, cases: readonly H4Case[]): Promise<H4Report> {
  const beforeDigest = fingerprint(), results: H4CaseResult[] = [];
  for (const item of cases) {
    let actual: string;
    try { actual = (await item.run()) === false ? "FALSE" : "UNEXPECTED_SUCCESS"; }
    catch (cause) { actual = cause instanceof Error && cause.message === "HISTORICAL_CHECKPOINT_QUARANTINED" ? cause.message : "UNEXPECTED_ERROR"; }
    const afterDigest = fingerprint(), stateUnchanged = beforeDigest === afterDigest;
    const status = actual === item.expected && stateUnchanged ? "PASS" : "BLOCKED";
    results.push({ id: item.id, alias: item.alias, expected: item.expected, actual, status, stateUnchanged });
    if (status !== "PASS") return { version: "H4C3-DIAG187-V1", at: new Date().toISOString(), status, reason: stateUnchanged ? "DENIAL_SIGNATURE_MISMATCH" : "STATE_CHANGED_STOP", fixtureSha256, beforeDigest, afterDigest, cases: results };
  }
  return { version: "H4C3-DIAG187-V1", at: new Date().toISOString(), status: "PASS", fixtureSha256, beforeDigest, afterDigest: fingerprint(), cases: results };
}
