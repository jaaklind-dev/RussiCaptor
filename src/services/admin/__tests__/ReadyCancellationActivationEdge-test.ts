import fs from "node:fs";
import path from "node:path";

const edge = fs.readFileSync(path.resolve(process.cwd(),
  "supabase/functions/platform-admin-exercises/index.ts"), "utf8");

describe("READY cancellation Admin Edge activation readback", () => {
  test("the existing Admin-only list reads the singleton activation state without exposing a toggle", () => {
    expect(edge).toContain("context = await requirePlatformAdmin(request)");
    expect(edge).toContain('from("ready_exercise_cancellation_activation")');
    expect(edge).toContain('eq("feature_key", "READY_CANCELLATION").maybeSingle()');
    expect(edge).toContain("!activationError && activation?.feature_key === \"READY_CANCELLATION\"");
    expect(edge).toContain("activation.enabled === true");
    expect(edge).not.toMatch(/operation: ["'](?:activate|deactivate|setActivation)["']/);
  });

  test("disabled database rejection is bounded and creates no cancellation audit action", () => {
    expect(edge).toContain('"READY_CANCELLATION_DISABLED"');
    expect(edge).not.toContain('audit(context, "EXERCISE_READY_CANCELLED"');
    expect(edge).toContain('body.operation !== "cancelReady"');
  });
});
