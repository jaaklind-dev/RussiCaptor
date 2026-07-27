import type { ModuleImportManifest, StagedModule } from "@/models/ModuleImport";
import { persistStagedPackage } from "@/services/ModuleImportService";

type State = {
  auditRuns: { id: string; status: string; error?: unknown }[];
  stagedModules: string[];
  exerciseVersions: string[];
  activeExerciseVersion?: string;
  failAt?: string;
};

function module(moduleId: string, moduleType: string, loadOrder: number): StagedModule {
  return {
    registry: {
      loadOrder, moduleId, moduleVersion: "1.0", moduleType,
      sourceFile: `${moduleId}.xlsx`, requiredForExercise: true, loadForExercise: true,
      active: true, importMode: "RUNTIME_CONFIG", duplicatePolicy: "REJECT", failurePolicy: "ABORT_IMPORT",
    },
    contentHash: moduleId.padEnd(64, "0").slice(0, 64),
    payload: { schemaVersion: 1, moduleId, moduleVersion: "1.0", moduleType, sourceFile: `${moduleId}.xlsx`, sheets: {} },
  };
}

function packageData() {
  const modules = [module("CORE_ENGINE", "ENGINE_CORE", 10), module("BOT_EXERCISE", "EXERCISE_INSTANCE", 20)];
  const manifest: ModuleImportManifest = {
    manifestId: "WP-8A", manifestVersion: "1.0", modules: modules.map(item => item.registry),
    dependencies: [], sheetRules: [], importUnits: [], deprecatedInputs: [], ownershipRules: [],
    bindings: [{
      exerciseId: "BOT-TEST", exerciseModuleId: "BOT_EXERCISE", requiredModuleId: "CORE_ENGINE",
      requiredVersion: "1.0", bindingType: "RUNTIME",
    }],
  };
  return { modules, manifest };
}

function inMemorySupabase(state: State) {
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "USER-1" } } }),
      signInAnonymously: async () => ({ data: { user: { id: "USER-1" } }, error: null }),
    },
    from(table: string) {
      return {
        insert(payload: unknown) {
          if (table === "import_runs") {
            state.auditRuns.push({ id: "RUN-1", status: "CREATED" });
            return { select: () => ({ single: async () => ({ data: { id: "RUN-1" }, error: null }) }) };
          }
          if (table === "exercise_versions") {
            state.exerciseVersions.push("VERSION-1");
            return { select: () => ({ single: async () => ({ data: { id: "VERSION-1" }, error: null }) }) };
          }
          if (table === "exercise_module_bindings") {
            return Promise.resolve({ error: state.failAt === "bindings" ? new Error("binding failure") : null, payload });
          }
          throw new Error(`Unexpected table ${table}`);
        },
      };
    },
    async rpc(name: string, payload: Record<string, unknown>) {
      if (name === "register_module_version") {
        if (state.failAt === "register" && payload.p_module_id === "BOT_EXERCISE") return { data: null, error: new Error("register failure") };
        state.stagedModules.push(String(payload.p_module_id));
        return { data: `MV-${payload.p_module_id}`, error: null };
      }
      if (name === "stage_import_run") {
        state.auditRuns[0].status = "STAGED";
        return { data: null, error: state.failAt === "stage" ? new Error("stage failure") : null };
      }
      if (name === "activate_exercise_import") {
        if (state.failAt === "activate") return { data: null, error: new Error("activation failure") };
        state.activeExerciseVersion = String(payload.p_exercise_version_id);
        state.auditRuns[0].status = "ACTIVE";
        return { data: null, error: null };
      }
      if (name === "fail_import_run") {
        state.auditRuns[0].status = "FAILED";
        state.auditRuns[0].error = payload.p_error_details;
        state.stagedModules = [];
        state.exerciseVersions = [];
        return { data: null, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  return client as unknown as Parameters<typeof persistStagedPackage>[4];
}

describe("WP-8A ModuleImportService persistence integration", () => {
  test("performs staging, binding and atomic activation", async () => {
    const state: State = { auditRuns: [], stagedModules: [], exerciseVersions: [] };
    const { modules, manifest } = packageData();
    await expect(persistStagedPackage(manifest, modules, "BOT-TEST", "1.0", inMemorySupabase(state), "USER-1"))
      .resolves.toBe("RUN-1");
    expect(state).toMatchObject({
      stagedModules: ["CORE_ENGINE", "BOT_EXERCISE"], exerciseVersions: ["VERSION-1"],
      activeExerciseVersion: "VERSION-1", auditRuns: [{ id: "RUN-1", status: "ACTIVE" }],
    });
  });

  test.each(["register", "bindings", "stage", "activate"])(
    "rolls back staging and retains audit when %s fails",
    async (failAt) => {
      const state: State = {
        auditRuns: [], stagedModules: [], exerciseVersions: [], activeExerciseVersion: "PREVIOUS", failAt,
      };
      const { modules, manifest } = packageData();
      await expect(persistStagedPackage(manifest, modules, "BOT-TEST", "1.0", inMemorySupabase(state), "USER-1"))
        .rejects.toThrow();
      expect(state.activeExerciseVersion).toBe("PREVIOUS");
      expect(state.stagedModules).toEqual([]);
      expect(state.exerciseVersions).toEqual([]);
      expect(state.auditRuns).toEqual([expect.objectContaining({ id: "RUN-1", status: "FAILED", error: expect.anything() })]);
    }
  );
});
