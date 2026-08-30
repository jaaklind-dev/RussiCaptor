import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("WP-NEXT-05 critical interaction integration", () => {
  test("all routes receive system inset protection and portrait policy is explicit", () => {
    const layout = read("app/_layout.tsx");
    expect(layout).toContain("SafeAreaProvider");
    expect(layout).toContain('edges={["top", "right", "bottom", "left"]}');
    expect(read("../app.json")).toContain('"orientation": "portrait"');
  });

  test("claim, transfer and lifecycle operations expose pending single-flight behavior", () => {
    const scan = read("app/scan.tsx");
    expect(scan).toContain("SingleFlightActionGate");
    expect(scan).toContain('accessibilityState={{ busy: pending, disabled: pending }}');
    expect(read("components/dashboard/TakeoverRequestsCard.tsx")).toContain("gate.run(operation)");
    const controls = read("components/excon/ExerciseControlsCard.tsx");
    expect(controls).toContain("SingleFlightActionGate");
    expect(controls).toContain("Kas lõpetada õppus?");
    expect(controls).toContain("See toiming on lõplik");
  });

  test("patient workspace retains first-tap keyboard handling and ownership feedback", () => {
    const workspace = read("app/patient/[id].tsx");
    expect(workspace).toContain('keyboardShouldPersistTaps="handled"');
    expect(workspace).toContain("Muudatus ootab serveri kinnitust");
    expect(workspace).toContain("Praegune juhtumikorraldaja");
  });

  test("release build does not restore demo-only interaction paths", () => {
    expect(read("../package.json")).not.toContain('"expo-dev-client"');
    expect(read("../app.json")).not.toContain('"expo-dev-client"');
  });
});
