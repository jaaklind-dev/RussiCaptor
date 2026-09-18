import fs from "fs";
import path from "path";

const migration = fs.readFileSync(path.resolve(process.cwd(),
  "supabase/migrations/20260918123000_large_canonical_checkpoint_publication_timeout.sql"), "utf8");

describe("WP-NARVA-10B30Q large canonical checkpoint publication timeout", () => {
  test.each([
    "publish_runtime_checkpoint_canonical_payload",
    "publish_runtime_checkpoint_canonical_payload_delta",
    "publish_runtime_checkpoint_canonical",
    "publish_runtime_checkpoint_canonical_delta",
    "finalize_runtime_completion_canonical_payload",
    "finalize_runtime_completion_canonical",
  ])("gives %s the bounded authority-critical timeout", functionName => {
    expect(migration).toMatch(new RegExp(
      `alter function public\\.${functionName}\\([\\s\\S]*?\\) set statement_timeout = '60s';`,
    ));
  });

  test("does not alter role/global timeout or publication semantics", () => {
    expect(migration).not.toMatch(/alter\s+(role|database)/i);
    expect(migration).not.toMatch(/create\s+or\s+replace\s+function/i);
    expect(migration).not.toMatch(/(insert|update|delete)\s+/i);
  });
});
