import fs from "fs";
import path from "path";

const migration = fs.readFileSync(path.resolve(process.cwd(),
  "supabase/migrations/20260907153105_narva_multicm_terminal_convergence.sql"), "utf8");

describe("WP-NARVA-06 backend authority migration", () => {
  test("adds a durable patient command inbox without adding checkpoint writers", () => {
    expect(migration).toMatch(/create table public\.runtime_patient_commands/);
    expect(migration).toMatch(/generated always as identity primary key/);
    expect(migration).toMatch(/submit_runtime_patient_command/);
    expect(migration).toMatch(/CM_WORKFLOW_WRITE/);
    expect(migration).toMatch(/owner_user_id is distinct from v_actor/);
    expect(migration).toMatch(/v_head\.revision<>p_expected_patient_revision/);
    expect(migration).toMatch(/unique \(exercise_id,command_id\)/);
    expect(migration).not.toMatch(/create or replace function public\.acquire_runtime_writer/);
  });

  test("keeps command writes RPC-only, scoped, auditable and payload-light in Realtime", () => {
    expect(migration).toMatch(/enable row level security/g);
    expect(migration).toMatch(/revoke all on public\.runtime_patient_commands from public,anon,authenticated/);
    expect(migration).toMatch(/grant select on public\.runtime_patient_commands to authenticated/);
    expect(migration).toMatch(/shared_workflow_commands[\s\S]*'MUTABLE'/);
    expect(migration).toMatch(/alter publication supabase_realtime add table public\.runtime_patient_command_notifications/);
    expect(migration).not.toMatch(/alter publication supabase_realtime add table public\.runtime_patient_commands/);
  });

  test("fences completion before terminalization and rejects post-fence mutation", () => {
    expect(migration).toMatch(/create table public\.runtime_completion_requests/);
    expect(migration).toMatch(/select coalesce\(max\(command_sequence\),0\) into v_fence/);
    expect(migration).toMatch(/exists\(select 1 from public\.runtime_completion_requests[\s\S]*COMPLETION_FENCED/);
    expect(migration).toMatch(/create trigger runtime_checkpoint_completion_fence/);
    expect(migration).toMatch(/TERMINAL_CHECKPOINT_REQUIRES_FENCE/);
  });

  test("atomically writes terminal checkpoint, projection, audit and explicit lease release", () => {
    const finalize = migration.slice(migration.indexOf("create or replace function public.finalize_runtime_completion"));
    expect(finalize).toMatch(/insert into public\.runtime_checkpoints/);
    expect(finalize).toMatch(/update public\.exercise_states set revision=/);
    expect(finalize).toMatch(/update public\.runtime_completion_requests set status='COMPLETED'/);
    expect(finalize).toMatch(/update public\.runtime_writer_leases set released_at=v_now/);
    expect(finalize).toMatch(/'WRITER_RELEASED'/);
    expect(finalize).toMatch(/v_cursor<v_request\.fence_command_sequence/);
    expect(finalize).toMatch(/status='ACCEPTED'/);
    expect(migration).toMatch(/create trigger terminal_runtime_lease_guard/);
    expect(migration).toMatch(/new\.released_at is null[\s\S]*status='COMPLETED'/);
  });

  test("failed terminal transaction cannot leave a completed projection behind", () => {
    const finalize = migration.slice(migration.indexOf("create or replace function public.finalize_runtime_completion"));
    const checkpoint = finalize.indexOf("insert into public.runtime_checkpoints");
    const projection = finalize.indexOf("update public.exercise_states");
    const completion = finalize.indexOf("update public.runtime_completion_requests set status='COMPLETED'");
    const release = finalize.indexOf("update public.runtime_writer_leases set released_at=v_now");
    expect(checkpoint).toBeGreaterThan(0);
    expect(projection).toBeGreaterThan(checkpoint);
    expect(completion).toBeGreaterThan(projection);
    expect(release).toBeGreaterThan(completion);
    expect(finalize).toMatch(/language plpgsql security definer/);
  });
});
