import type { GoldenFixture } from "@/models/GoldenTest";
import { bootstrapBotulismRoot, tickBotulismRoot } from "@/services/runtime/BotulismRootPatientProcess";
import { applyHypoxiaOxygen, bootstrapHypoxiaPatientProcess, tickHypoxiaPatientProcess } from "@/services/runtime/HypoxiaPatientProcess";

const fixture: GoldenFixture = {
  fixtureId: "FX-BRANCH", fixtureType: "PATIENT", seed: 1, clockState: "RUNNING",
  ownershipVersion: 1, activeResources: {}, loadedModules: [], initialState: {},
};

describe("WP-8A clinical process branch coverage", () => {
  test("Botulism root supports alternate assignment shape, resolved state and defaults", () => {
    const root = bootstrapBotulismRoot({ ...fixture, initialState: {
      patientId: "PT-1",
      botulismProcesses: [
        { PatientProcessID: "ROOT", TemplateID: "BOT", ProcessType: "BOT_TOXIN_ACTIVITY", Status: "Resolved", InitialReserve: 0, ProgressionRate: 0, InstanceKey: "root" },
        { PatientProcessID: "CHILD", TemplateID: "CHILD", ProcessType: "BOT_CHILD", Status: "Active", InitialReserve: 2, ProgressionRate: 1, ParentProcessID: "ROOT", InstanceKey: "child" },
      ],
    }});
    expect(root.encounterId).toBe("PT-1");
    expect(root.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ processId: "ROOT", state: "Resolved", parentProcessId: undefined }),
      expect.objectContaining({ processId: "CHILD", parentProcessType: "BOT_TOXIN_ACTIVITY" }),
    ]));
    expect(tickBotulismRoot(root, 120)).toMatchObject({ elapsedTime: 120, nextTick: 180 });
  });

  test("Botulism root rejects fixtures without process descriptions", () => {
    expect(() => bootstrapBotulismRoot(fixture)).toThrow("protsesside loend puudub");
  });

  test("Hypoxia covers worsening, improving and saturation-stable branches", () => {
    const base = bootstrapHypoxiaPatientProcess(fixture, {});
    const worsening = tickHypoxiaPatientProcess(base, 60);
    expect(worsening.clinicalState.spo2Trend).toBe("WORSENING");
    const improving = tickHypoxiaPatientProcess(applyHypoxiaOxygen(base), 60);
    expect(improving.clinicalState.spo2Trend).toBe("IMPROVING");
    const saturated = bootstrapHypoxiaPatientProcess(fixture, { spo2: 100, oxygenationReserve: 100, oxygenTherapyActive: true });
    expect(tickHypoxiaPatientProcess(saturated, 60).clinicalState.spo2Trend).toBe("STABLE");
  });
});
