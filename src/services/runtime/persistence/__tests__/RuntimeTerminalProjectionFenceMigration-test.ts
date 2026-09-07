import fs from "fs";
import path from "path";

const migration = fs.readFileSync(path.resolve(process.cwd(),
  "supabase/migrations/20260907163357_narva_terminal_projection_fence.sql"), "utf8");

describe("WP-NARVA-06 terminal projection fence hardening", () => {
  test("blocks stale projection writes from the moment completion is fenced", () => {
    expect(migration).toMatch(/create trigger runtime_terminal_projection_fence/);
    expect(migration).toMatch(/before insert or update on public\.exercise_states/);
    expect(migration).toMatch(/current_setting\('russicaptor\.terminal_finalize_command',true\)/);
    expect(migration).toMatch(/is distinct from v_request\.command_id[\s\S]*COMPLETION_FENCED/);
  });

  test("permits only the matching atomic finalizer and prevents terminal resurrection", () => {
    expect(migration).toMatch(/v_request\.status='COMPLETED'/);
    expect(migration).toMatch(/exercise_lifecycle_from_state\(new\.state\)<>'COMPLETED'/);
    expect(migration).toMatch(/EXERCISE_COMPLETED/);
    expect(migration).toMatch(/revoke all on function public\.guard_runtime_terminal_projection\(\)[\s\S]*public,anon,authenticated/);
  });
});
