import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(),
  "supabase/migrations/20260915170000_narva_laboratory_runtime_commands.sql"), "utf8");

describe("laboratory durable command migration", () => {
  test("adds only lab order/collection to the existing command inbox", () => {
    expect(migration).toContain("'LAB_ORDER','LAB_COLLECT'");
    expect(migration).toContain("insert into public.runtime_patient_commands");
    expect(migration).toContain("p_expected_patient_revision+1");
    expect(migration).not.toMatch(/create table public\.lab/i);
  });

  test("validates narrow payloads and preserves completion, ownership and CAS fences", () => {
    expect(migration).toContain("p_command_payload - 'labPackageId'");
    expect(migration).toContain("p_command_payload - 'orderId' - 'patientBloodIdentity'");
    expect(migration).toContain("v_exercise.state->'exercisePackageReference'->>'packageId'");
    expect(migration).toContain("v_head.revision<>p_expected_patient_revision");
    expect(migration).toContain("v_head.owner_user_id is distinct from v_actor");
    expect(migration).toContain("rcr.status in ('PENDING','COMPLETED')");
  });

  test("is authenticated-only and pins the security-definer search path", () => {
    expect(migration).toContain("language plpgsql security definer set search_path=''");
    expect(migration).toContain("revoke all on function public.submit_runtime_patient_command");
    expect(migration).toContain("from public,anon");
    expect(migration).toContain("to authenticated");
  });
});
