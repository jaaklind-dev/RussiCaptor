import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const release = JSON.parse(fs.readFileSync(path.resolve(root, "release/field-release.json"), "utf8"));
const app = JSON.parse(fs.readFileSync(path.resolve(root, "app.json"), "utf8")).expo;

describe("post-C11 field-release compatibility", () => {
  test("canonical Android version is above the prior signed distributable", () => {
    expect(release.versionCode).toBeGreaterThan(178);
    expect(release.minimumVersionCodeExclusive).toBeGreaterThanOrEqual(178);
    expect(app.android.versionCode).toBe(release.versionCode);
    expect(release.artifactFilename).toContain(`v${release.versionCode}.apk`);
  });

  test("current privileged and writer-fence migrations are mandatory backend prerequisites", () => {
    const required = new Map<string, string>(release.requiredSupabaseMigrations.map(
      (item: { remoteVersion: string; localFile: string }) => [item.remoteVersion, item.localFile],
    ));
    for (const filename of [
      "20261010051206_platform_admin_break_glass_recovery.sql",
      "20261010110021_builder_lab_package_binding.sql",
      "20261011090155_exercise_state_server_writer_fence.sql",
      "20261012102900_atomic_active_writer_takeover.sql",
      "20261016065854_ready_exercise_cancellation.sql",
    ]) {
      const version = filename.split("_")[0];
      expect(required.get(version)).toBe(filename);
      expect(fs.existsSync(path.resolve(root, "supabase/migrations", filename))).toBe(true);
    }
  });

  test("remote compatibility verification rejects a backend missing READY cancellation", () => {
    const versions = release.requiredSupabaseMigrations.map(
      (item: { remoteVersion: string }) => item.remoteVersion,
    );
    const verify = (deployed: string[]) => spawnSync(process.execPath,
      [path.resolve(root, "scripts/verify-field-release-config.mjs")], {
        encoding: "utf8", env: { ...process.env,
          RUSSICAPTOR_REQUIRE_REMOTE_MIGRATIONS: "1",
          RUSSICAPTOR_MIGRATION_PROJECT_REF: "fimcsrivizpliiuoqopv",
          RUSSICAPTOR_DEPLOYED_MIGRATIONS: deployed.join(","),
        },
      });
    const missing = verify(versions.filter((version: string) => version !== "20261016065854"));
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("required remote migration 20261016065854 is not deployed");
    expect(verify(versions).status).toBe(0);
  });

  test("canonical build has no acceptance-probe activation path", () => {
    const build = fs.readFileSync(path.resolve(root, "scripts/build-field-release.mjs"), "utf8");
    expect(build).not.toMatch(/C11_STALE_WRITER_PROBE|c11StaleWriterProbe|c11ProbeRequested/);
    expect(build).toContain('EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS: plan.sharedWorkflowValidationHarness');
    const policy = fs.readFileSync(path.resolve(root, "scripts/field-release-policy.mjs"), "utf8");
    expect(policy).toContain('if (!validation && harness)');
    expect(policy).toContain('sharedWorkflowValidationHarness: validation && harness');
  });
});
