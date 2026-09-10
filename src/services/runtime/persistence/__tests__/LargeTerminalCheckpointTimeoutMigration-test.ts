import fs from "fs";
import path from "path";

const migration = fs.readFileSync(path.resolve(process.cwd(),
  "supabase/migrations/20260910090104_large_terminal_checkpoint_timeout.sql"), "utf8");

describe("WP-NARVA-10A1 large terminal checkpoint timeout", () => {
  test("extends only the atomic terminal finalizer to the bounded API maximum", () => {
    expect(migration).toMatch(/alter function public\.finalize_runtime_completion\(text,text,uuid,text,bigint,jsonb\)/);
    expect(migration).toMatch(/set statement_timeout = '60s'/);
    expect(migration).not.toMatch(/alter (?:database|role)/i);
    expect(migration).not.toMatch(/create or replace function/i);
  });

  test("does not introduce another checkpoint authority or weaken access", () => {
    expect(migration).not.toMatch(/security definer|grant execute|service_role/i);
    expect(migration).not.toMatch(/runtime_checkpoints|exercise_states|runtime_completion_requests|runtime_writer_leases/);
  });
});
