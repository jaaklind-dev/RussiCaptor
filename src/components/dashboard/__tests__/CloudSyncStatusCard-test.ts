import fs from "node:fs";
import path from "node:path";

import { resumeRuntime } from "../CloudSyncStatusCard";

describe("WP-44B Runtime Resume control", () => {
  test("enabled Resume dispatch invokes the existing authority handler exactly once", async () => {
    const resume = jest.fn(async () => ({ state: "WRITER" as const, revision: 717 }));

    await expect(resumeRuntime(resume)).resolves.toEqual({ state: "WRITER", revision: 717 });
    expect(resume).toHaveBeenCalledTimes(1);
  });

  test("uses a full-width accessible Android touch target without changing the command path", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/components/dashboard/CloudSyncStatusCard.tsx"),
      "utf8",
    );

    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain("hitSlop={8}");
    expect(source).toContain('alignSelf: "stretch"');
    expect(source).toContain("minHeight: 48");
    expect(source).toContain("onPress={() => void resumeRuntime()}");
  });
});
