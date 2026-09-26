import React from "react";
import { act, create } from "react-test-renderer";

import { PelvicBinderControls } from "@/components/patient/PelvicBinderControls";
import { PleuralDrainControls } from "@/components/patient/PleuralDrainControls";
import { restoreExerciseSession, resetExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { packagePatientDatasetRegistry } from "@/services/exercise/CanonicalPatientDatasets";
import { exercisePackageLoader } from "@/services/exercise/ExercisePackageService";
import { NARVA_TRAUMA_EXERCISE_PACKAGE } from "@/services/exercise/NarvaExercisePackages";
import { createPatientMaterializationPlan } from "@/services/exercise/PackagePatientMaterializationService";

const exerciseId = "EX-PROC-UI";

describe("PROC-G06 Narva procedure presentation", () => {
  beforeAll(() => exercisePackageLoader.bind(exerciseId, NARVA_TRAUMA_EXERCISE_PACKAGE));
  beforeEach(() => restoreExerciseSession({ exerciseId, lifecycleState: "RUNNING", simulationTimeSec: 0,
    speed: 1, version: 1, clockVersion: 1, clockInitializedAtSimulationTimeSec: 0 }));
  afterEach(() => resetExerciseSession());

  const publishFixture = (patientId: string) => {
    const fixture = createPatientMaterializationPlan(exerciseId, NARVA_TRAUMA_EXERCISE_PACKAGE,
      packagePatientDatasetRegistry).patients.find(item => item.patient.id === patientId)!.runtimeFixture!;
    const engine = new ClinicalScenarioEngine(); engine.reset(structuredClone(fixture));
    return engine;
  };

  test.each([
    ["PT-PELVIC-001", true, false],
    ["PT-CHEST-001", false, true],
  ] as const)("projects only package-authorized controls for %s", (patientId, binderVisible, drainVisible) => {
    let binder!: ReturnType<typeof create>; let drain!: ReturnType<typeof create>;
    act(() => {
      publishFixture(patientId);
      binder = create(<PelvicBinderControls patientId={patientId} />);
      drain = create(<PleuralDrainControls patientId={patientId} />);
    });
    expect(binder.root.findAllByProps({ testID: "canonical-pelvic-binder-controls" }).length > 0)
      .toBe(binderVisible);
    expect(drain.root.findAllByProps({ testID: "canonical-pleural-drain-controls" }).length > 0)
      .toBe(drainVisible);
    act(() => { binder.unmount(); drain.unmount(); });
  });
});
