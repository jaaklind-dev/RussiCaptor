import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");
const layout = fs.readFileSync(path.join(root, "src/app/_layout.tsx"), "utf8");
const callback = fs.readFileSync(path.join(root, "src/services/auth/AuthCallbackService.ts"), "utf8");
const passwordScreen = fs.readFileSync(path.join(root, "src/app/auth/set-password.tsx"), "utf8");
const usersFunction = fs.readFileSync(path.join(root, "supabase/functions/platform-admin-users/index.ts"), "utf8");

describe("Auth callback and password security guardrails", () => {
  test("AUTH-CB-01/11: callback is a first-class route outside operational role gating", () => {
    expect(layout).toContain('if (root === "auth") return');
    expect(layout).toContain("<AuthCallbackCoordinator />");
    expect(callback).toContain('AUTH_CALLBACK_URI = "russicaptor://auth/callback"');
  });

  test("AUTH-CB-07/10: password uses authenticated Supabase update and no application persistence", () => {
    expect(callback).toContain("client.auth.updateUser({ password })");
    expect(callback).not.toMatch(/AsyncStorage|localStorage|setItem|console\./);
    expect(passwordScreen).toContain("secureTextEntry");
    expect(passwordScreen).not.toMatch(/AsyncStorage|localStorage|console\./);
  });

  test("ADMIN-REDIRECT-01/02: invite and reset use one configured callback", () => {
    expect(usersFunction).toContain('canonicalRedirect = "russicaptor://auth/callback"');
    expect(usersFunction).toContain("inviteUserByEmail");
    expect(usersFunction).toContain("resetPasswordForEmail(email, { redirectTo: authRedirect() })");
    expect(usersFunction.match(/redirectTo: authRedirect\(\)/g)).toHaveLength(2);
  });

  test("ADMIN-REDIRECT-03: missing or stale callback config fails closed", () => {
    expect(usersFunction).toContain('throw new Error("AUTH_REDIRECT_NOT_CONFIGURED")');
    expect(usersFunction).not.toContain("allowedRedirect ?");
  });
});
