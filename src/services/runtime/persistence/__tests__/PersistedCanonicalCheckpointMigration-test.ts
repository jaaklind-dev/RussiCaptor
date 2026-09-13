import fs from "node:fs";
import path from "node:path";

describe("WP-NARVA-10B14 forward-only canonical checkpoint migration", () => {
  const migration = fs.readFileSync(path.join(process.cwd(),
    "supabase/migrations/20260913124047_persisted_canonical_checkpoint.sql"), "utf8");
  const derivation = fs.readFileSync(path.join(process.cwd(),
    "supabase/migrations/20260913125630_legacy_canonical_checkpoint_derivation.sql"), "utf8");
  const numericCompatibility = fs.readFileSync(path.join(process.cwd(),
    "supabase/migrations/20260913130142_preserve_json_numeric_lexemes_in_legacy_derivation.sql"), "utf8");

  test("is additive and leaves original checkpoint payload/hash untouched", () => {
    expect(migration).toContain("create table public.runtime_checkpoint_canonical_artifacts");
    expect(migration).not.toMatch(/update\s+public\.runtime_checkpoints\s+set/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.runtime_checkpoints/i);
    expect(migration).not.toMatch(/alter\s+table\s+public\.runtime_checkpoints\s+drop/i);
  });

  test("binds canonical text to the current source row and exact historical hash", () => {
    expect(migration).toContain("v_checkpoint.checkpoint_revision<>p_checkpoint_revision");
    expect(migration).toContain("v_checkpoint.payload_hash<>p_payload_hash");
    expect(migration).toContain("v_checkpoint.provenance_hash<>p_provenance_hash");
    expect(migration).toContain("extensions.digest(convert_to(p_canonical_payload_text,'UTF8'),'sha256')");
    expect(migration).toContain("p_canonical_payload_text::jsonb is distinct from v_checkpoint.payload->'payload'");
  });

  test("keeps artifacts out of Realtime and preserves scoped reads", () => {
    expect(migration).toContain("has_authorization_permission('EXERCISE_JOIN',exercise_id)");
    expect(migration).not.toMatch(/add table public\.runtime_checkpoint_canonical_artifacts/i);
    expect(migration).toContain("to service_role");
  });

  test("legacy derivation is service-role-only, additive and hash-fenced by the installer", () => {
    expect(derivation).toContain("derive_legacy_runtime_checkpoint_canonical_artifact");
    expect(derivation).toContain("install_runtime_checkpoint_canonical_artifact");
    expect(derivation).toContain("'LEGACY_DERIVATION'");
    expect(derivation).toContain("to service_role");
    expect(derivation).not.toMatch(/update\s+public\.runtime_checkpoints/i);
    expect(derivation).not.toMatch(/delete\s+from\s+public\.runtime_checkpoints/i);
  });

  test("legacy compatibility preserves the exact JSON numeric lexemes hashed by historical writers", () => {
    expect(numericCompatibility).toContain("return p_value::text");
    expect(numericCompatibility).not.toContain("double precision");
    expect(numericCompatibility).not.toMatch(/update\s+public\.runtime_checkpoints/i);
  });
});
