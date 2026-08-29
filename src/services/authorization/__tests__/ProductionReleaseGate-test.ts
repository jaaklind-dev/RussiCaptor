import fs from "fs";
import path from "path";

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
});
