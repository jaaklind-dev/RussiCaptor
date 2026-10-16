import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(path.resolve(process.cwd(),
  "supabase/migrations/20261016065854_ready_exercise_cancellation.sql"), "utf8");
const edge = fs.readFileSync(path.resolve(process.cwd(),
  "supabase/functions/platform-admin-exercises/index.ts"), "utf8");

function functionBody(name: string): string {
  const match = sql.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`));
  if (!match) throw new Error(`Missing function ${name}`);
  return match[0];
}

describe("READY cancellation server contract", () => {
  test("only the bounded Admin Edge operation can invoke cancellation", () => {
    const cancel = functionBody("trusted_admin_cancel_ready_exercise");
    expect(edge).toContain("context.service.rpc(\"trusted_admin_cancel_ready_exercise\"");
    expect(edge).toContain("context = await requirePlatformAdmin(request)");
    expect(cancel).toContain("admin.status = 'ACTIVE'");
    expect(cancel).toContain("profile.status = 'ACTIVE'");
    expect(sql).toMatch(/revoke all on function public\.trusted_admin_cancel_ready_exercise[\s\S]*?from public,anon,authenticated,service_role;/);
    expect(sql).toMatch(/grant execute on function public\.trusted_admin_cancel_ready_exercise[\s\S]*?to service_role;/);
    expect(sql).not.toMatch(/grant (?:insert|update) on (?:table )?public\.exercise_states to authenticated/i);
  });

  test("READY, exact revision, no active writer, and no workflow are mandatory", () => {
    const cancel = functionBody("trusted_admin_cancel_ready_exercise");
    expect(cancel).toContain("v_state.revision <> p_expected_revision");
    expect(cancel).toContain("exercise_lifecycle_from_state(v_state.state) <> 'READY'");
    expect(cancel).toContain("v_lease.expires_at > v_now");
    expect(cancel).toContain("ACTIVE_WRITER_PRESENT");
    for (const table of ["runtime_checkpoints", "runtime_completion_requests",
      "shared_workflow_patient_states", "shared_workflow_commands",
      "runtime_patient_commands", "runtime_patient_command_notifications",
      "shared_workflow_notifications"]) {
      expect(cancel).toContain(`public.${table}`);
    }
    expect(cancel).toContain("RUNTIME_ACTIVITY_PRESENT");
  });

  test("writer acquisition and cancellation share lock and row order", () => {
    const cancel = functionBody("trusted_admin_cancel_ready_exercise");
    const acquire = functionBody("acquire_runtime_writer");
    const key = "pg_catalog.hashtextextended(p_exercise_id,7621)";
    expect(cancel).toContain(key);
    expect(acquire).toContain(key);
    for (const body of [cancel, acquire]) {
      const lease = body.indexOf("from public.runtime_writer_leases as lease");
      const checkpoint = body.indexOf("from public.runtime_checkpoints as checkpoint");
      const state = body.indexOf("from public.exercise_states as es");
      expect(lease).toBeGreaterThan(0);
      expect(lease).toBeLessThan(checkpoint);
      expect(checkpoint).toBeLessThan(state);
    }
    expect(acquire).toContain("v_lifecycle not in ('READY','RUNNING','PAUSED')");
    expect(sql).toContain("create trigger guard_terminal_runtime_writer_lease");
  });

  test("identical retry returns a receipt and conflict cannot write another state", () => {
    const cancel = functionBody("trusted_admin_cancel_ready_exercise");
    expect(cancel).toContain("v_op.request_hash <> v_hash");
    expect(cancel).toContain("OPERATION_ID_CONFLICT");
    expect(cancel.indexOf("return query select p_exercise_id,v_op.result_revision"))
      .toBeLessThan(cancel.indexOf("update public.exercise_states as es"));
    expect(cancel).toContain("where es.exercise_id = p_exercise_id and es.revision = p_expected_revision");
    expect(cancel).toContain("'EXERCISE_READY_CANCELLED'");
    expect(cancel).toContain("'SUCCESS'");
    expect(edge).not.toContain('audit(context, "EXERCISE_READY_CANCELLED"');
    expect(edge).toContain('body.operation !== "cancelReady"');
  });

  test("the singleton activation gate is seeded OFF and invisible to ordinary clients", () => {
    expect(sql).toContain("create table public.ready_exercise_cancellation_activation");
    expect(sql).toContain("values ('READY_CANCELLATION', false, 'MIGRATION_DEFAULT_OFF')");
    expect(sql).toContain("alter table public.ready_exercise_cancellation_activation enable row level security");
    expect(sql).toMatch(/revoke all on table public\.ready_exercise_cancellation_activation\s+from public,anon,authenticated,service_role;/);
    expect(sql).toContain("grant select on table public.ready_exercise_cancellation_activation to service_role");
    expect(sql).not.toMatch(/grant (?:insert|update|delete) on table public\.ready_exercise_cancellation_activation to (?:anon|authenticated|service_role)/i);
  });

  test("OFF fails before receipt readback and holds a transactional gate lock", () => {
    const cancel = functionBody("trusted_admin_cancel_ready_exercise");
    const gate = cancel.indexOf("from public.ready_exercise_cancellation_activation as gate");
    const disabled = cancel.indexOf("READY_CANCELLATION_DISABLED");
    const receipt = cancel.indexOf("from public.exercise_state_publication_operations as op");
    const exerciseLock = cancel.indexOf("pg_catalog.pg_advisory_xact_lock");
    expect(gate).toBeGreaterThan(0);
    expect(cancel).toContain("for share");
    expect(disabled).toBeGreaterThan(gate);
    expect(disabled).toBeLessThan(exerciseLock);
    expect(exerciseLock).toBeLessThan(receipt);
    expect(cancel).toContain("v_activation_enabled is distinct from true");
  });

  test("only the database deployment operator can change activation, with atomic audit", () => {
    const activation = functionBody("set_ready_exercise_cancellation_activation");
    expect(activation).toContain("security invoker set search_path = ''");
    expect(activation).toContain("for update");
    expect(activation).toContain("update public.ready_exercise_cancellation_activation");
    expect(activation).toContain("insert into public.administrative_action_audit");
    expect(activation).toContain("'READY_CANCELLATION_ENABLED'");
    expect(activation).toContain("'READY_CANCELLATION_DISABLED'");
    expect(activation).toContain("p_change_reference");
    expect(sql).toMatch(/revoke all on function public\.set_ready_exercise_cancellation_activation\(boolean,text\)\s+from public,anon,authenticated,service_role;/);
    expect(sql).not.toMatch(/grant execute on function public\.set_ready_exercise_cancellation_activation/i);
  });

  test("terminal row rejects new patient mutation and role grant but keeps separate role revoke", () => {
    expect(functionBody("guard_cancelled_shared_workflow_mutation")).toContain("v_lifecycle = 'CANCELLED'");
    expect(functionBody("trusted_admin_grant_exercise_role")).toContain("'COMPLETED','CANCELLED','TERMINATED'");
    expect(edge).toContain("session.lifecycleState");
    expect(edge).toContain('operation: "revokeRole"');
    expect(edge).toContain('context.service.rpc("trusted_admin_revoke_exercise_role"');
  });

  test("the cancellation request is bounded and leaves the production writer path closed", () => {
    const cancel = functionBody("trusted_admin_cancel_ready_exercise");
    expect(cancel).toContain("p_reason not in ('UNUSED_READY','FAILED_START','TEST_CLEANUP')");
    expect(cancel).toContain("p_actor_user_id is null");
    expect(cancel).toContain("person.banned_until");
    expect(cancel).toContain("v_state.revision + 1");
    expect(sql).toContain("revoke all on function public.trusted_admin_cancel_ready_exercise");
    expect(edge).toContain("context = await requirePlatformAdmin(request)");
    expect(edge).not.toContain('context.service.from("exercise_states").update(');
  });

  test("a cancelled exercise cannot obtain or renew an authoritative lease", () => {
    const acquire = functionBody("acquire_runtime_writer");
    const leaseGuard = functionBody("guard_terminal_runtime_writer_lease");
    expect(acquire).toContain("v_lifecycle not in ('READY','RUNNING','PAUSED')");
    expect(leaseGuard).toContain("v_lifecycle not in ('READY','RUNNING','PAUSED')");
    expect(sql).toContain("before insert or update on public.runtime_writer_leases");
  });

  test("canonical publication and archive continue to reject non-active/non-completed state", () => {
    const writerFence = fs.readFileSync(path.resolve(process.cwd(),
      "supabase/migrations/20261011090155_exercise_state_server_writer_fence.sql"), "utf8");
    expect(writerFence).toContain("v_current_lifecycle not in ('READY','RUNNING','PAUSED')");
    expect(writerFence).toContain("exercise_lifecycle_from_state(v_state.state)<>'COMPLETED'");
    expect(sql).not.toMatch(/grant (?:insert|update) on (?:table )?public\.exercise_states to authenticated/i);
  });

  test("the Admin control is READY-only and requires explicit confirmation", () => {
    const ui = fs.readFileSync(path.resolve(process.cwd(), "src/app/admin/exercises.tsx"), "utf8");
    expect(ui).toContain('exercise.lifecycleState === "READY"');
    expect(ui).toContain('Alert.alert("Tühista kasutamata õppus"');
    expect(ui).toContain('testID="admin-cancel-ready"');
    expect(ui).toContain("Rollide tühistamine on eraldi toiming.");
  });

  test("cancel is not archive-as-completed and retains the original canonical row", () => {
    const cancel = functionBody("trusted_admin_cancel_ready_exercise");
    expect(cancel).toContain("'{exerciseSession,lifecycleState}'");
    expect(cancel).toContain('"CANCELLED"');
    expect(cancel).not.toMatch(/delete from public\.exercise_states/i);
    const writerFence = fs.readFileSync(path.resolve(process.cwd(),
      "supabase/migrations/20261011090155_exercise_state_server_writer_fence.sql"), "utf8");
    expect(writerFence).toContain("exercise_lifecycle_from_state(v_state.state)<>'COMPLETED'");
  });
});
