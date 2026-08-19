import fs from "node:fs";
import path from "node:path";

import { getRuntimeAuthorityPresentation, resumeRuntime } from "../CloudSyncStatusCard";

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
    expect(source).toContain("void resumeRuntime().finally(() => setTakeoverPending(false))");
    expect(source).toContain('"Võta Runtime üle"');
    expect(source).toContain('"Võtan Runtime’i üle…"');
  });

  test("terminal exercise lifecycle suppresses stale reader authority presentation", () => {
    expect(getRuntimeAuthorityPresentation("COMPLETED", { state: "READER", revision: 137 })).toEqual({
      label: "Runtime peatatud",
      takeoverVisible: false,
    });
    expect(getRuntimeAuthorityPresentation("READY", { state: "READER", revision: 137 })).toEqual({
      label: "Runtime peatatud",
      takeoverVisible: false,
    });
  });

  test("active lifecycle continues to expose a genuine remote writer", () => {
    expect(getRuntimeAuthorityPresentation("RUNNING", { state: "READER", revision: 138 })).toEqual({
      label: "Simulatsioon töötab teises seadmes · ainult vaatamine",
      takeoverVisible: true,
    });
  });

  test("EXCON exercise dashboard exposes the shared canonical takeover control", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/app/excon/dashboard.tsx"),
      "utf8",
    );

    expect(source).toContain('import CloudSyncStatusCard from "@/components/dashboard/CloudSyncStatusCard"');
    expect(source).toContain("<CloudSyncStatusCard lifecycleState={exerciseSnapshot.lifecycleState} />");
  });
});
