import React, { useSyncExternalStore } from "react";
import TestRenderer, { act } from "react-test-renderer";

import type { LaboratoryResultGroup, LaboratoryWorkflowSnapshot } from "@/models/LaboratoryWorkflow";
import { getCanonicalExerciseSnapshot, getCanonicalExerciseSnapshotVersion,
  replaceCanonicalExerciseSnapshot, subscribeToCanonicalExerciseSnapshot } from
  "@/repositories/ExerciseSessionRepository";
import { DEFAULT_EXERCISE_PACKAGE } from "@/services/exercise/CanonicalExercisePackages";
import { exercisePackageLoader, getExercisePackageBindingVersion,
  subscribeToExercisePackageBindings } from "@/services/exercise/ExercisePackageService";
import { NARVA_TRAUMA_EXERCISE_PACKAGE } from "@/services/exercise/NarvaExercisePackages";
import { laboratoryPackageForActiveExercise } from
  "@/services/runtime/laboratory/LaboratoryWorkflowCommandService";
import LabsTab from "../LabsTab";

const EXERCISE_ID = "EX-B32A-RESTORED";

const group = (type: LaboratoryResultGroup["type"], analyteId: string,
  value: string | number): LaboratoryResultGroup => Object.freeze({
  resultGroupId: `RESULT-${type}`, sampleId: "SAMPLE-B31", type,
  availableAtSimulationTimeSec: 2_500, generatedAtSimulationTimeSec: 2_501,
  status: "RESULTED", generationVersion: "narva-lab-static-v1",
  resultPayload: Object.freeze({ analytes: [Object.freeze({ analyteId, value })] }),
});

const restoredWorkflow: LaboratoryWorkflowSnapshot = Object.freeze({
  schemaVersion: 1,
  orders: [Object.freeze({ orderId: "ORDER-B31", exerciseId: EXERCISE_ID,
    patientId: "PT-PELVIC-001", packageId: "NARVA_POLYTRAUMA",
    orderedAtSimulationTimeSec: 100, orderedBy: "CM", status: "RESULTED" })],
  samples: [Object.freeze({ sampleId: "SAMPLE-B31", orderId: "ORDER-B31",
    exerciseId: EXERCISE_ID, patientId: "PT-PELVIC-001", sampledAtSimulationTimeSec: 1_000,
    sourcePatientRevision: 12, sourceRuntimeStateVersion: 18,
    snapshot: Object.freeze({ schemaVersion: 1, displayedVitals: {}, targetVitals: {},
      runtimeFields: {}, clinicalProcessInputs: [] }) })],
  resultGroups: Object.freeze([
    group("ASTRUP", "LAB_PH", 7.31),
    group("HEMATOLOGY", "LAB_HB", 101),
    group("AB0", "LAB_AB0", "A"),
    group("CLINICAL_CHEMISTRY", "LAB_NA", 139),
    group("COAGULATION", "LAB_INR", 1.4),
  ]),
  patientBloodIdentities: {},
});

function RestoredLabsPath() {
  useSyncExternalStore(subscribeToExercisePackageBindings, getExercisePackageBindingVersion,
    getExercisePackageBindingVersion);
  return <LabsTab labs={[]} onOpenPanel={jest.fn()} laboratoryWorkflow={restoredWorkflow}
    laboratoryPackageId={laboratoryPackageForActiveExercise(EXERCISE_ID)}
    onOrderLaboratory={jest.fn().mockResolvedValue({ ok: true, message: "ok" })}
    onCollectLaboratory={jest.fn().mockResolvedValue({ ok: true, message: "ok" })} />;
}

function ProductionRestoreOrderLabsPath() {
  useSyncExternalStore(subscribeToExercisePackageBindings, getExercisePackageBindingVersion,
    getExercisePackageBindingVersion);
  useSyncExternalStore(subscribeToCanonicalExerciseSnapshot, getCanonicalExerciseSnapshotVersion,
    getCanonicalExerciseSnapshotVersion);
  const exerciseId = getCanonicalExerciseSnapshot().exerciseId;
  return <LabsTab labs={[]} onOpenPanel={jest.fn()} laboratoryWorkflow={restoredWorkflow}
    laboratoryPackageId={laboratoryPackageForActiveExercise(exerciseId)}
    onOrderLaboratory={jest.fn().mockResolvedValue({ ok: true, message: "ok" })}
    onCollectLaboratory={jest.fn().mockResolvedValue({ ok: true, message: "ok" })} />;
}

describe("B32A restored laboratory package binding", () => {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    renderer = undefined;
    exercisePackageLoader.unbind(EXERCISE_ID);
  });

  test("cold restore reactively binds the authoritative Narva package and renders preserved results", async () => {
    exercisePackageLoader.bind(EXERCISE_ID, DEFAULT_EXERCISE_PACKAGE);
    await act(async () => { renderer = TestRenderer.create(<RestoredLabsPath />); });
    expect(renderer!.root.findAllByProps({ testID: "legacy-laboratory-empty" }).length).toBeGreaterThan(0);

    await act(async () => {
      exercisePackageLoader.unbind(EXERCISE_ID);
      exercisePackageLoader.bind(EXERCISE_ID, NARVA_TRAUMA_EXERCISE_PACKAGE);
    });

    expect(laboratoryPackageForActiveExercise(EXERCISE_ID)).toBe("NARVA_POLYTRAUMA");
    for (const type of ["ASTRUP", "HEMATOLOGY", "AB0", "CLINICAL_CHEMISTRY", "COAGULATION"]) {
      expect(renderer!.root.findByProps({ testID: `laboratory-group-section-${type}` })).toBeTruthy();
    }
    expect(renderer!.root.findAllByProps({ testID: "legacy-laboratory-empty" })).toHaveLength(0);
    expect(renderer!.root.findByProps({ testID: "laboratory-result-LAB_PH" })).toBeTruthy();
    for (const type of ["HEMATOLOGY", "AB0", "CLINICAL_CHEMISTRY", "COAGULATION"]) {
      await act(async () => {
        renderer!.root.findByProps({ testID: `laboratory-group-toggle-${type}` }).props.onPress();
      });
    }
    for (const analyteId of ["LAB_HB", "LAB_AB0", "LAB_NA", "LAB_INR"]) {
      expect(renderer!.root.findByProps({ testID: `laboratory-result-${analyteId}` })).toBeTruthy();
    }
  });

  test("an exercise without a laboratory package keeps the legacy empty state", async () => {
    exercisePackageLoader.bind(EXERCISE_ID, DEFAULT_EXERCISE_PACKAGE);
    await act(async () => { renderer = TestRenderer.create(<RestoredLabsPath />); });
    expect(renderer!.root.findAllByProps({ testID: "legacy-laboratory-empty" }).length).toBeGreaterThan(0);
    expect(renderer!.root.findAll(node => node.props.testID?.startsWith("laboratory-group-section-")))
      .toHaveLength(0);
  });

  test("session identity publication completes the production restore ordering after package binding", async () => {
    const previous = getCanonicalExerciseSnapshot();
    const oldExerciseId = "EX-B32A-PREVIOUS";
    exercisePackageLoader.bind(oldExerciseId, DEFAULT_EXERCISE_PACKAGE);
    replaceCanonicalExerciseSnapshot({ exerciseId: oldExerciseId, lifecycleState: "RUNNING",
      simulationTimeSec: 10, speed: 1, version: 1 });
    await act(async () => { renderer = TestRenderer.create(<ProductionRestoreOrderLabsPath />); });
    expect(renderer!.root.findAllByProps({ testID: "legacy-laboratory-empty" }).length).toBeGreaterThan(0);

    // StatePersistenceService intentionally installs the restored package before restoring session identity.
    await act(async () => { exercisePackageLoader.bind(EXERCISE_ID, NARVA_TRAUMA_EXERCISE_PACKAGE); });
    expect(renderer!.root.findAllByProps({ testID: "legacy-laboratory-empty" }).length).toBeGreaterThan(0);

    await act(async () => {
      replaceCanonicalExerciseSnapshot({ exerciseId: EXERCISE_ID, lifecycleState: "RUNNING",
        simulationTimeSec: 2_501, speed: 1, version: 67 });
    });
    expect(renderer!.root.findAllByProps({ testID: "legacy-laboratory-empty" })).toHaveLength(0);
    for (const type of ["ASTRUP", "HEMATOLOGY", "AB0", "CLINICAL_CHEMISTRY", "COAGULATION"]) {
      expect(renderer!.root.findByProps({ testID: `laboratory-group-section-${type}` })).toBeTruthy();
    }

    await act(async () => {
      replaceCanonicalExerciseSnapshot(previous as Parameters<typeof replaceCanonicalExerciseSnapshot>[0]);
      exercisePackageLoader.unbind(oldExerciseId);
    });
  });
});
