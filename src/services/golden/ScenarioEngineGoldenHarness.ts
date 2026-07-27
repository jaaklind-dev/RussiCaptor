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
    return {
      state: {
        HV: {
          ventilationReserve: runtimeState.runtimeFields.ventilationReserve,
          co2Burden: runtimeState.runtimeFields.co2Burden,
        },
        RuntimeState: runtimeState,
        PatientProcess: patientProcess,
      },
      stateHash: this.engine.getHashes().stateHash,
      processTreeHash: this.engine.getHashes().processTreeHash,
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
