import fs from "node:fs";
import path from "node:path";

describe("WP-NARVA-10B15 canonical-primary writer publication migration", () => {
  const migration = fs.readFileSync(path.join(process.cwd(),
    "supabase/migrations/20260913133730_decouple_canonical_checkpoint_publication.sql"), "utf8");

  test("accepts canonical text as the only full semantic request representation", () => {
    expect(migration).toContain("publish_runtime_checkpoint_canonical_payload(");
    expect(migration).toContain("publish_runtime_checkpoint_canonical_payload_delta(");
    expect(migration).toContain("finalize_runtime_completion_canonical_payload(");
    expect(migration).toContain("runtime_checkpoint_from_canonical_payload(");
    expect(migration).toContain("v_payload:=p_canonical_payload_text::jsonb");
  });

  test("verifies exact canonical UTF-8 bytes before parsing them into queryable JSONB", () => {
    const hash = migration.indexOf("extensions.digest(convert_to(p_canonical_payload_text,'UTF8'),'sha256')");
    const parse = migration.indexOf("v_payload:=p_canonical_payload_text::jsonb");
    expect(hash).toBeGreaterThan(0);
    expect(parse).toBeGreaterThan(hash);
    expect(migration).toContain("v_payload#>>'{exerciseSession,exerciseId}' is distinct from p_exercise_id");
  });

  test("keeps terminal checkpoint, canonical artifact and completion ACK in one transaction", () => {
    const terminal = migration.slice(migration.indexOf("finalize_runtime_completion_canonical_payload("));
    expect(terminal.indexOf("perform public.finalize_runtime_completion(")).toBeGreaterThan(0);
    expect(terminal.indexOf("perform public.persist_verified_runtime_checkpoint_canonical_artifact(")).toBeGreaterThan(
      terminal.indexOf("perform public.finalize_runtime_completion("));
    expect(terminal).not.toMatch(/\bcommit\b/i);
  });

  test("rejects differing same-revision artifacts and preserves historical operational rows", () => {
    expect(migration).toContain("CANONICAL_CHECKPOINT_IMMUTABILITY_VIOLATION");
    expect(migration).not.toMatch(/delete\s+from\s+public\.runtime_checkpoints/i);
    expect(migration).not.toMatch(/update\s+public\.runtime_completion_requests/i);
    expect(migration).not.toMatch(/update\s+public\.exercise_states/i);
  });

  test("keeps canonical artifacts outside Realtime and internal helpers inaccessible to clients", () => {
    expect(migration).not.toMatch(/alter\s+publication/i);
    expect(migration).toContain("from public,anon,authenticated");
  });
});
