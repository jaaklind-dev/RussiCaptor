import type { GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";

const tick = (eventId: string, target: string, seconds: number): GoldenInputEvent => ({
  sequenceId: `SEQ-${eventId}`, step: 1, offsetSec: seconds, eventType: "ENGINE_TICK",
  actor: "ENGINE", target, eventId, result: "SUCCESS", payload: { tickMin: seconds / 60 },
});

const hvFixture: GoldenFixture = {
  fixtureId: "FX-LIFECYCLE-HV", fixtureType: "PROCESS", seed: 36, clockState: "RUNNING",
  ownershipVersion: 1, activeResources: {}, loadedModules: ["HYPOVENTILATION_HYPERCAPNIA_V1"],
  initialState: { processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV-BASELINE",
    ventilationReserve: 52, reserveLossPerMin: 3.8, co2Burden: 38, co2GainPerMin: 4 },
};

const hypoxiaFixture: GoldenFixture = {
  fixtureId: "FX-LIFECYCLE-HYPOXIA", fixtureType: "PROCESS", seed: 37, clockState: "RUNNING",
  ownershipVersion: 1, activeResources: {}, loadedModules: ["HYPOVENTILATION_HYPERCAPNIA_V1", "HYPOXIA_V1"],
  initialState: { hv: { templateId: "HV-HYPOXIA", ventilationReserve: 52, co2Burden: 38 },
    hypoxia: { templateId: "HYP-BASELINE", oxygenationReserve: 58, spo2: 90 } },
};

const hemorrhageConfiguration = {
  baselineBleedingRateMlMin: 100, tourniquetEfficiency: 0.9, binderEfficiency: 0.5,
  infusionOffsetMlMin: 10, bloodProductOffsetMlMin: 25,
  severityThresholdsMl: [100, 300, 600, 1000] as [number, number, number, number],
  perfusionThresholdsMl: [250, 500, 900] as [number, number, number],
  compensationThresholdsMl: [400, 800] as [number, number],
  trendThresholdsMlMin: { worsening: 50, improving: 10 },
};

const hemorrhageFixture: GoldenFixture = {
  fixtureId: "FX-LIFECYCLE-HEM", fixtureType: "PROCESS", patientId: "PT-LIFECYCLE-HEM", seed: 38,
  clockState: "RUNNING", ownershipVersion: 1, loadedModules: ["HEMORRHAGE_V1"], activeResources: {},
  initialState: { processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: "HV-HEM",
    ventilationReserve: 50, reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0,
    hemorrhage: { configuration: hemorrhageConfiguration } },
};

const botulismFixture: GoldenFixture = {
  fixtureId: "FX-LIFECYCLE-BOT", fixtureType: "PATIENT", patientId: "PT-LIFECYCLE-BOT", seed: 39,
  clockState: "RUNNING", ownershipVersion: 1, activeResources: {},
  loadedModules: ["BOTULISM_V1", "HYPOVENTILATION_HYPERCAPNIA_V1", "HYPOXIA_V1"],
  initialState: { PatientID: "PT-LIFECYCLE-BOT", processAssignments: [
    { PatientProcessID: "PP-TOX", TemplateID: "BOT-TOX", ProcessType: "BOT_TOXIN_ACTIVITY", Status: "Active", InitialReserve: 95, ProgressionRate: 1.7, ParentProcessID: null, InstanceKey: "toxin" },
    { PatientProcessID: "PP-CRAN", TemplateID: "BOT-CRAN", ProcessType: "BOT_CRANIAL_BULBAR", Status: "Active", InitialReserve: 28, ProgressionRate: 2.4, ParentProcessID: "PP-TOX", InstanceKey: "cranial" },
    { PatientProcessID: "PP-RESP", TemplateID: "BOT-RESP", ProcessType: "BOT_RESPIRATORY_MUSCLE_FAILURE", Status: "Active", InitialReserve: 18, ProgressionRate: 3.8, ParentProcessID: "PP-TOX", InstanceKey: "resp" },
  ] },
};

function run(fixture: GoldenFixture, seconds: number): ClinicalScenarioEngine {
  const engine = new ClinicalScenarioEngine(); engine.reset(fixture); engine.advanceTo(seconds);
  engine.dispatch(tick(`TICK-${fixture.fixtureId}`, fixture.patientId ?? fixture.fixtureId, seconds));
  return engine;
}

const baseline = (engine: ClinicalScenarioEngine) => ({
  hashes: engine.getHashes(),
  processOrder: engine.getPatientProcesses().map(process => `${process.processType}:${process.processId}`),
  eventOrder: engine.getEventLog().map(event => `${event.sequence}:${event.eventType}:${event.target}`),
  rootChildren: engine.getBotulismRoot()?.children.map(child => child.processId) ?? [],
});

describe("WP-36A immutable production lifecycle baselines", () => {
  test("protects HV", () => expect(baseline(run(hvFixture, 60))).toEqual({
    hashes: { stateHash: "567a227bc8f44dd98d3524094fc8630cd3397831bea3caa3069aad7b8c93e20d", eventLogHash: "b09b7bee051cbc9c134d8b37c19667572f393272b5d8d8a01787e0e5e668713c", processTreeHash: "052a3231ffa9b75d63be042bba016d8e7daa771c6a885a317a82e2b5ba54715b", resourcePoolHash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", replayHash: "8077887e6452a4d4511ff6db7091e3e5e692a8b246b471ca3b90f90848dc5316" },
    processOrder: ["HYPOVENTILATION_HYPERCAPNIA:HV-BASELINE"], eventOrder: ["1:ENGINE_TICK_APPLIED:HV-BASELINE"], rootChildren: [],
  }));
  test("protects HV + Hypoxia", () => expect(baseline(run(hypoxiaFixture, 60))).toEqual({
    hashes: { stateHash: "7137585429dd06dc9eaa0efd4bae2dc39fcadcf6e490c9d2515c926cce0c7f94", eventLogHash: "1f987446fd1c6585546a544ccd3370c8ed44aaf08e4e4bd67c95c415f6f69f40", processTreeHash: "4994a23a0dc60d10491bf9bea426d2a34a0ac1ef29d10949b800e4069e02c0b2", resourcePoolHash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", replayHash: "2d062055f4689ffa32ded768d6854d534fc78839fd373a5c6966202ebde568c3" },
    processOrder: ["HYPOVENTILATION_HYPERCAPNIA:HV-HYPOXIA", "HYPOXIA:HV-HYPOXIA:HYP-BASELINE"], eventOrder: ["1:PROCESS_TICK_APPLIED:HV-HYPOXIA:HYP-BASELINE", "2:ENGINE_TICK_APPLIED:HV-HYPOXIA"], rootChildren: [],
  }));
  test("protects Hemorrhage", () => expect(baseline(run(hemorrhageFixture, 60))).toEqual({
    hashes: { stateHash: "33e5b2b3b4c80ecb71ae2bc842ed52d7f2748cba18806d3df787281f456478d8", eventLogHash: "69a0dcb1e157037277ef526d7825dae48090d39b65fe7002811b13a2c3e00bca", processTreeHash: "b2df0738a6d11180646dc3daeb43e52db06e78e10c0f186ec48fd19132d77e7b", resourcePoolHash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", replayHash: "3ac5e1797f03e094926a5c946767fccc143488475c8e3a5abeb2d7fb2185a81b" },
    processOrder: ["HYPOVENTILATION_HYPERCAPNIA:HV-HEM", "HEMORRHAGE:PT-LIFECYCLE-HEM:HEMORRHAGE"], eventOrder: ["1:HemorrhageStarted:PT-LIFECYCLE-HEM", "2:ENGINE_TICK_APPLIED:HV-HEM"], rootChildren: [],
  }));
  test("protects Botulism root and children", () => expect(baseline(run(botulismFixture, 60))).toEqual({
    hashes: { stateHash: "d4fe6fd10aabcbb32106fea76c2e676a4455cb6a2e3a0fde857bca4a1eba0010", eventLogHash: "14383e7f80e6fc153b9dc534af514af1f78826510336dddae9bc3f93ceec415a", processTreeHash: "c04672538cc1053bd0a7bd780d9ae280e6bdf5e0ba385d68db0dec30272f5cc0", resourcePoolHash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", replayHash: "cb4ffc0a97be8732a31cff3cf865db5e58e14c0875469bcc2783417732ba8ae7" },
    processOrder: ["HYPOVENTILATION_HYPERCAPNIA:PP-RESP:HV_NM_SEV", "HYPOXIA:PP-RESP:HV_NM_SEV:HYP_HYPOVENT_MOD"], eventOrder: ["1:PROCESS_TICK_APPLIED:PP-RESP:HV_NM_SEV:HYP_HYPOVENT_MOD", "2:ENGINE_TICK_APPLIED:PP-RESP:HV_NM_SEV"], rootChildren: ["PP-CRAN", "PP-RESP", "PP-TOX"],
  }));
});
