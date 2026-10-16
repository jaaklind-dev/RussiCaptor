import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const release = JSON.parse(fs.readFileSync(path.resolve(root, "release/field-release.json"), "utf8"));
const app = JSON.parse(fs.readFileSync(path.resolve(root, "app.json"), "utf8")).expo;

describe("post-C11 field-release compatibility", () => {
  test("canonical Android version is above the highest validated acceptance build", () => {
    expect(release.versionCode).toBeGreaterThan(173);
    expect(release.minimumVersionCodeExclusive).toBeGreaterThanOrEqual(173);
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
    ]) {
      const version = filename.split("_")[0];
      expect(required.get(version)).toBe(filename);
      expect(fs.existsSync(path.resolve(root, "supabase/migrations", filename))).toBe(true);
    }
  });

  test("canonical build has no acceptance-probe activation path", () => {
    const build = fs.readFileSync(path.resolve(root, "scripts/build-field-release.mjs"), "utf8");
    expect(build).not.toMatch(/C11_STALE_WRITER_PROBE|c11StaleWriterProbe|c11ProbeRequested/);
    expect(build).toContain('releaseVariant === "canonical" && validationHarnessRequested');
    expect(build).toContain('EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS: releaseVariant !== "canonical"');
  });
});
