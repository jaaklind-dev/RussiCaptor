import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const root = path.resolve(__dirname, "../../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("WP-NEXT-02 production release gate", () => {
  test("login uses password auth rather than navigation or anonymous sign-in", () => {
    const login = read("app/index.tsx");
    expect(login).toContain("signInOperator");
    expect(login).toContain("secureTextEntry");
    expect(login).not.toContain("href=\"/dashboard\"");
    expect(read("services/CloudSyncService.ts")).not.toContain("signInAnonymously");
    expect(read("services/ModuleImportService.ts")).not.toContain("signInAnonymously");
  });

  test("startup does not acquire cloud/runtime state before operator authorization", () => {
    const layout = read("app/_layout.tsx");
    expect(layout).toContain('getOperatorSession().state !== "AUTHENTICATED"');
    expect(layout.indexOf("unsubscribeOperator = startOperatorSession()")).toBeLessThan(layout.indexOf("void startAfterCurrentExerciseDiscovery"));
  });

  test("release dashboard has no demo identity switch and routes are centrally gated", () => {
    expect(read("app/dashboard.tsx")).not.toContain("Demo CM");
    expect(read("services/CurrentUserService.ts")).toContain("__DEV__ ? [jaak, demoTransferTarget] : []");
    expect(read("app/_layout.tsx")).toContain("ProductionRouteGate");
    expect(read("app/_layout.tsx")).toContain('hasActiveRole(operator, "EXCON"');
    expect(read("app/_layout.tsx")).toContain('hasActiveRole(operator, "CM"');
  });

  test("field release excludes dev client and uses external signing", () => {
    expect(read("../package.json")).not.toContain('"expo-dev-client"');
    expect(read("../app.json")).not.toContain('"expo-dev-client"');
    expect(read("../app.json")).toContain('"android.permission.SYSTEM_ALERT_WINDOW"');
    const nativeConfigurator = read("../scripts/configure-field-release-native.mjs");
    expect(nativeConfigurator).toContain("RUSSICAPTOR_RELEASE_KEYSTORE");
    expect(nativeConfigurator).toContain("signingConfig signingConfigs.release");
    expect(nativeConfigurator).not.toContain("releaseSigningConfigured ?");
    expect(read("../scripts/build-field-release.mjs")).not.toContain("RUSSICAPTOR_VALIDATION_SIGNING");
    expect(read("../release/field-release.json")).toContain("b6c51fff4d0df61569a423aa99df2ac5d5a92d3e897c1d30198980e59fcde96b");
    expect(read("config/ReleaseConfig.ts")).toContain("EXPO_PUBLIC_RELEASE_ENVIRONMENT");
  });

  test("release verification fails closed when a required remote migration is absent", () => {
    const script = path.join(root, "../scripts/verify-field-release-config.mjs");
    const rejected = spawnSync(process.execPath, [script], { encoding: "utf8", env: {
      ...process.env,
      RUSSICAPTOR_REQUIRE_REMOTE_MIGRATIONS: "1",
      RUSSICAPTOR_DEPLOYED_MIGRATIONS: "20260829135717",
    }});
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("required remote migration");

    const accepted = spawnSync(process.execPath, [script], { encoding: "utf8", env: {
      ...process.env,
      RUSSICAPTOR_REQUIRE_REMOTE_MIGRATIONS: "1",
      RUSSICAPTOR_DEPLOYED_MIGRATIONS: "202608190001,20260826190508,20260828083146,20260828113258,20260829124632,20260829124829,20260829135717",
    }});
    expect(accepted.status).toBe(0);
  });
});
