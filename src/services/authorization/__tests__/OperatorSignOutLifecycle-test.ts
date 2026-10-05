import fs from "node:fs";
import path from "node:path";

import {
  prepareOperatorSignOut,
  registerOperatorSignOutPreparation,
  resetOperatorSignOutLifecycleForTests,
} from "@/services/authorization/OperatorSignOutLifecycle";

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("RUNTIME-SIGNOUT-WRITER-LEASE-RELEASE-01", () => {
  beforeEach(() => resetOperatorSignOutLifecycleForTests());

  test("SIGNOUT-WRITER-01 writer logout runs the registered canonical release boundary", async () => {
    const release = jest.fn(async () => undefined);
    registerOperatorSignOutPreparation(release);
    await prepareOperatorSignOut();
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("SIGNOUT-WRITER-02 reader logout skips writer release when no boundary is registered", async () => {
    await expect(prepareOperatorSignOut()).resolves.toBeUndefined();
  });

  test("SIGNOUT-WRITER-03 auth signOut is ordered after runtime preparation", () => {
    const auth = source("src/services/authorization/OperatorSessionService.ts");
    expect(auth.indexOf("await prepareOperatorSignOut()"))
      .toBeLessThan(auth.indexOf('supabase.auth.signOut({ scope: "local" })'));
  });

  test("SIGNOUT-WRITER-04 successful release clears the matching local lease", () => {
    const runtime = source("src/services/RuntimeCheckpointSyncService.ts");
    expect(runtime).toContain("await repository.releaseWriter(currentLease)");
    expect(runtime).toContain("if(lease?.leaseId===currentLease.leaseId)lease=undefined");
    expect(runtime.indexOf("await repository.releaseWriter(currentLease)"))
      .toBeLessThan(runtime.indexOf("if(lease?.leaseId===currentLease.leaseId)lease=undefined"));
  });

  test("SIGNOUT-WRITER-05 simultaneous logout taps share one release", async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const release = jest.fn(() => pending);
    registerOperatorSignOutPreparation(release);
    const first = prepareOperatorSignOut();
    const second = prepareOperatorSignOut();
    await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second]);
  });

  test("SIGNOUT-WRITER-06 lease expiry is not a client-side release blocker", () => {
    const runtime = source("src/services/RuntimeCheckpointSyncService.ts");
    const boundary = runtime.slice(runtime.indexOf("const prepareWriterSignOut"), runtime.indexOf("const stopSignOutPreparation"));
    expect(boundary).not.toMatch(/expiresAt|Date\.now/);
  });

  test("SIGNOUT-WRITER-07 stale cleanup cannot clear a replacement lease", () => {
    const runtime = source("src/services/RuntimeCheckpointSyncService.ts");
    expect(runtime).toContain("if(lease?.leaseId===currentLease.leaseId)lease=undefined");
    const migration = source("supabase/migrations/202608120003_runtime_checkpoint_authority.sql");
    expect(migration).toMatch(/writer_user_id<>auth\.uid\(\).*writer_instance_id<>p_writer_instance_id/);
  });

  test("SIGNOUT-WRITER-08 release failure is retryable and does not silently destroy auth", async () => {
    const release = jest.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    registerOperatorSignOutPreparation(release);
    await expect(prepareOperatorSignOut()).rejects.toThrow("offline");
    await expect(prepareOperatorSignOut()).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledTimes(2);
  });

  test("SIGNOUT-WRITER-09 preparation fails local writer authority closed", () => {
    const runtime = source("src/services/RuntimeCheckpointSyncService.ts");
    const boundary = runtime.slice(runtime.indexOf("const prepareWriterSignOut"), runtime.indexOf("const stopSignOutPreparation"));
    expect(boundary).toContain('setRuntimeWriterAuthorityState("READER")');
    expect(boundary).toContain("beginRuntimeReaderConvergence(exerciseId)");
    expect(boundary).toContain('setStatus({state:"FAILED",code:"WRITER_SIGNOUT_RELEASE_FAILED"');
  });

  test("SIGNOUT-WRITER-10 stopped generation unregisters sign-out authority", async () => {
    const stale = jest.fn(async () => undefined);
    const unregister = registerOperatorSignOutPreparation(stale);
    unregister();
    await prepareOperatorSignOut();
    expect(stale).not.toHaveBeenCalled();
  });

  test("SIGNOUT-WRITER-11 role revoke remains guarded by canonical lease absence", () => {
    const admin = source("supabase/functions/platform-admin-exercises/index.ts");
    expect(admin).toContain('from("runtime_writer_leases")');
    expect(admin).toContain('throw new Error("ACTIVE_RUNTIME_OWNERSHIP_CONFLICT")');
    expect(admin.indexOf("ACTIVE_RUNTIME_OWNERSHIP_CONFLICT"))
      .toBeLessThan(admin.indexOf('rpc("trusted_admin_revoke_exercise_role"'));
  });

  test("SIGNOUT-WRITER-12 a subsequent eligible runtime may register after release", async () => {
    const first = jest.fn(async () => undefined);
    const stopFirst = registerOperatorSignOutPreparation(first);
    await prepareOperatorSignOut();
    stopFirst();
    const second = jest.fn(async () => undefined);
    registerOperatorSignOutPreparation(second);
    await prepareOperatorSignOut();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("logout UI exposes only a bounded retry message", () => {
    for (const file of ["src/app/dashboard.tsx", "src/app/excon/index.tsx", "src/app/admin/index.tsx"]) {
      const ui = source(file);
      expect(ui).toContain("Väljalogimine ei õnnestunud täielikult. Proovi uuesti.");
      expect(ui).not.toMatch(/leaseId|release_runtime_writer|Supabase/);
    }
  });
});
