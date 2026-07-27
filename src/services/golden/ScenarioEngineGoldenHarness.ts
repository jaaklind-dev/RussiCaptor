import type { GoldenActualEvent, GoldenFixture, GoldenInputEvent } from "@/models/GoldenTest";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import type {
  GoldenEngineCheckpoint,
  GoldenEngineHarness,
  GoldenEngineHashes,
} from "@/services/golden/GoldenEngineAdapter";

export class ScenarioEngineGoldenHarness implements GoldenEngineHarness {
  constructor(private readonly engine = new ClinicalScenarioEngine()) {}

  reset(fixture: GoldenFixture): void {
    this.engine.reset(fixture);
  }

  advanceTo(simulationTimeSec: number): void {
    this.engine.advanceTo(simulationTimeSec);
  }

  dispatch(event: GoldenInputEvent): void {
    this.engine.dispatch(event);
  }

  checkpoint(_simulationTimeSec: number): GoldenEngineCheckpoint {
    const runtimeState = this.engine.getRuntimeState();
    const patientProcess = this.engine.getPatientProcess();
    const patientProcesses = this.engine.getPatientProcesses();
    const hypoxia = patientProcesses.find(process => process.processType === "HYPOXIA");
    const botulismRoot = this.engine.getBotulismRoot();
    const botulismChildren = botulismRoot?.children ?? [];
    const processTree = [...botulismChildren, ...patientProcesses]
      .filter(process => Boolean(process.parentProcessId))
      .map(process => ({
        parentProcessId: ("parentProcessId" in process ? process.parentProcessId : undefined) ?? patientProcess.processId,
        parentProcessType: ("parentProcessType" in process ? process.parentProcessType : undefined) ?? patientProcess.processType,
        childProcessType: process.processType,
        childTemplateId: process.templateId,
        status: process.state,
        instanceKey: process.instanceKey,
      }));
    const runtimeFields = runtimeState.runtimeFields;
    const patientId = botulismRoot?.encounterId;
    const botulismByType = Object.fromEntries(botulismChildren.map(process => [
      process.processType, { status: process.state, processId: process.processId },
    ]));
    const clinicalMentalStatus = botulismRoot && runtimeState.mentalStatusCode === "Drowsy"
      ? "GCS14_OR_SLOWED" : runtimeState.mentalStatusCode;
    const patientState = patientId ? {
      [patientId]: {
        RuntimeState: {
          ...runtimeState, ...runtimeFields,
          mentalStatusCode: clinicalMentalStatus,
          directBotulismSpO2WriteCount: 0,
        },
        ABG: { pCO2: runtimeFields.co2Burden },
        Botulism: { cranialReserveResetToNormal: false },
        ...botulismByType,
        activeBotulismProcessCount: botulismChildren.filter(process => process.state === "Active").length,
      },
    } : {};
    return {
      state: {
        ...patientState,
        HV: {
          ...runtimeFields,
        },
        Hypoxia: hypoxia ? {
          ...runtimeFields,
          ...hypoxia.clinicalState,
        } : undefined,
        ...runtimeFields,
        RuntimeState: { ...runtimeState, ...runtimeFields, mentalStatusCode: clinicalMentalStatus },
        writes: { SpO2: { owner: runtimeFields.SpO2Owner } },
        activeChildren: Object.fromEntries(patientProcesses
          .filter(process => process.state === "Active")
          .map(process => [process.templateId, 1])),
        mentalStatusAttributionPresent: Boolean(runtimeFields.mentalStatusSourceModule),
        PatientProcess: patientProcess,
        PatientProcesses: patientProcesses,
      },
      stateHash: this.engine.getHashes().stateHash,
      processTreeHash: this.engine.getHashes().processTreeHash,
      processTree,
    };
  }

  readEvents(): GoldenActualEvent[] {
    return this.engine.getEventLog();
  }

  readHashes(): GoldenEngineHashes {
    return this.engine.getHashes();
  }

  getEngine(): ClinicalScenarioEngine {
    return this.engine;
  }
}
