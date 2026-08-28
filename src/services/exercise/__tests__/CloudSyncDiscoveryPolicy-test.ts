import fs from "node:fs";
import path from "node:path";

import { EXERCISE_DISCOVERY_ACTIVE_FILTER } from "@/services/CloudSyncService";

describe("WP-EGRESS-05 CloudSync discovery integration", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/services/CloudSyncService.ts"), "utf8");

  test("startup remains the authoritative discovery gate and stable polling is no longer five seconds", () => {
    expect(source).toContain('await refreshRemoteCurrentExercise("startup")');
    expect(source).toContain("EXERCISE_DISCOVERY_SAFETY_INTERVAL_MS");
    expect(source).not.toContain("refreshRemoteCurrentExercise(); }, 5_000");
  });

  test("foreground and reconnect reconcile while duplicate refreshes are centrally coalesced", () => {
    expect(source).toContain('refreshRemoteCurrentExercise("foreground")');
    expect(source).toContain('refreshRemoteCurrentExercise("reconnect")');
    expect(source).toContain("ExerciseDiscoveryRefreshCoordinator");
  });

  test("discovery never subscribes to the large exercise state row", () => {
    const connectivity = source.slice(source.indexOf('channel("exercise-discovery-connectivity")'));
    expect(connectivity).not.toContain("postgres_changes");
    expect(source).not.toContain('table: "exercise_states"');
    expect(source).toContain("exercise_session:state->exerciseSession");
    expect(source).not.toMatch(/from\("exercise_states"\)\s*\n\s*\.select\("\*"\)/);
  });

  test("no-active, running, paused and conflict discovery retain the existing bounded projection", () => {
    expect(EXERCISE_DISCOVERY_ACTIVE_FILTER).toContain("READY,RUNNING,PAUSED");
    expect(source).toContain("if (discoveryRows.length === 0)");
    expect(source).toContain('if (selection.status === "CONFLICT")');
    expect(source).toContain('lifecycle === "RUNNING" || lifecycle === "PAUSED"');
    expect(source).toContain("shouldFetchTerminalDiscoveryState");
  });

  test("restart tears down the previous timer, connectivity channel and AppState listener", () => {
    const start = source.slice(source.indexOf("export async function startCloudSync"));
    expect(start.indexOf("clearInterval(remotePollTimer)")).toBeLessThan(start.indexOf("remotePollTimer = setInterval"));
    expect(start).toContain("stopDiscoveryConnectivity?.()");
    expect(start).toContain("stopDiscoveryAppState?.()");
  });
});
