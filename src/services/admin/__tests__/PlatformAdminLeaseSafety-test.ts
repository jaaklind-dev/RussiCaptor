import { readFileSync } from "node:fs";
import path from "node:path";
import { isActiveRuntimeWriterLease } from "../../../../supabase/functions/_shared/runtimeLease";

const now = Date.parse("2026-10-10T17:00:00.000Z");
const lease = (expires_at: string, released_at: string | null = null) => ({ expires_at, released_at });

describe("platform admin Runtime lease safety", () => {
  test("an unexpired unreleased writer blocks cleanup", () => {
    expect(isActiveRuntimeWriterLease(lease("2026-10-10T17:00:01.000Z"), now)).toBe(true);
  });

  test("an expired unreleased writer is historical, not active", () => {
    expect(isActiveRuntimeWriterLease(lease("2026-10-10T16:59:59.000Z"), now)).toBe(false);
    expect(isActiveRuntimeWriterLease(lease("2026-10-10T17:00:00.000Z"), now)).toBe(false);
  });

  test("explicit release clears ownership even before expiry", () => {
    expect(isActiveRuntimeWriterLease(lease("2026-10-10T18:00:00.000Z", "2026-10-10T16:55:00.000Z"), now)).toBe(false);
  });

  test("malformed expiry fails closed", () => {
    expect(isActiveRuntimeWriterLease(lease("invalid"), now)).toBe(true);
  });

  test("exercise revoke and user deactivation use the same active predicate", () => {
    const exercise = readFileSync(path.resolve("supabase/functions/platform-admin-exercises/index.ts"), "utf8");
    const users = readFileSync(path.resolve("supabase/functions/platform-admin-users/index.ts"), "utf8");
    expect(exercise).toContain("lease && isActiveRuntimeWriterLease(lease)");
    expect(users).toContain("some(lease => isActiveRuntimeWriterLease(lease))");
    expect(exercise).toContain("if (leaseError || ownerError) throw");
    expect(users).toContain("if (assignmentError || bootstrapError || leaseError || ownerError) throw");
  });

  test("the writer RPC still uses expiry and enforces one live owner", () => {
    const migration = readFileSync(path.resolve("supabase/migrations/202608120003_runtime_checkpoint_authority.sql"), "utf8");
    expect(migration).toContain("v_lease.released_at is null and v_lease.expires_at > v_now");
    expect(migration).toContain("raise exception 'WRITER_AUTHORITY_HELD'");
  });
});
