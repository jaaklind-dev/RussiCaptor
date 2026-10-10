import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(),
  "supabase/migrations/20261010104843_builder_lab_package_binding.sql"), "utf8");
const priorRpc = readFileSync(resolve(process.cwd(),
  "supabase/migrations/20260926143000_add_patient_complete_runtime_patient_command.sql"), "utf8");

describe("compiled Builder laboratory package authority", () => {
  it("registers only an exact immutable ID/version/hash/catalog identity", () => {
    expect(migration).toContain("primary key (package_id, package_version)");
    expect(migration).toContain("package_hash text not null check");
    expect(migration).toContain("catalog_package_id text not null check");
    expect(migration).toContain("LAB_PACKAGE_VERSION_CONFLICT");
  });

  it("keeps the registration table private and registration platform-admin-only", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("from public, anon, authenticated, service_role");
    expect(migration).toContain("if not public.is_platform_admin() then");
    expect(migration).toContain("registered_by, registration_source");
    expect(migration).not.toMatch(/startsWith|like 'russicaptor\.builder-%'/i);
  });

  it("binds the deployed TEST package to its verified hash and one existing catalog", () => {
    expect(migration).toContain("'russicaptor.builder-picker-test153', '1.0.0'");
    expect(migration).toContain("993ec01c571c158afc9f8715520887dd83dacaac535efd5d3f7cde0f7488129c");
    expect(migration).toContain("'NARVA_POLYTRAUMA', 'DEPLOYMENT'");
  });

  it("rejects wrong exercise, package ID, version, hash, and catalog", () => {
    expect(migration).toContain("binding.package_id = p_state->'exercisePackageReference'->>'packageId'");
    expect(migration).toContain("binding.package_version = p_state->'exercisePackageReference'->>'packageVersion'");
    expect(migration).toContain("binding.package_hash = p_state->'patientMaterialization'->>'packageHash'");
    expect(migration).toContain("binding.catalog_package_id = p_catalog_package_id");
    expect(migration).toContain("p_state->'patientMaterialization'->>'exerciseId' = p_exercise_id");
  });

  it("retains both legacy Narva scopes without widening their catalog", () => {
    expect(migration).toContain("p_catalog_package_id = 'NARVA_POLYTRAUMA'");
    expect(migration).toContain("= 'russicaptor.narva-trauma'");
    expect(migration).toContain("p_catalog_package_id = 'NARVA_IRO_ASTRUP'");
    expect(migration).toContain("= 'russicaptor.narva-iro-evacuation'");
    expect(migration).toContain("check (package_id not in ('russicaptor.narva-trauma'");
  });

  it("freezes active package hash alongside its ID/version", () => {
    expect(migration).toContain("v_old_lifecycle not in ('RUNNING', 'PAUSED')");
    expect(migration).toContain("old.state->'patientMaterialization'->>'packageHash'");
    expect(migration).toContain("new.state->'patientMaterialization'->>'packageHash'");
  });

  it("replaces exactly the narrow scope predicate, preserving ownership, CAS, and completion fences", () => {
    expect(priorRpc).toContain("v_head.revision<>p_expected_patient_revision");
    expect(priorRpc).toContain("v_head.owner_user_id is distinct from v_actor");
    expect(priorRpc).toContain("rcr.status in ('PENDING','COMPLETED')");
    expect(migration).toContain("pg_get_functiondef('public.submit_runtime_patient_command");
    expect(migration).toContain("length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old)");
    expect(migration).toContain("execute replace(v_definition, v_old, v_new)");
  });
});
