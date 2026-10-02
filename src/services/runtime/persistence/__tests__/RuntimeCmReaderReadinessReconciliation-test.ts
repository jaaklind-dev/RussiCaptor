import type { RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { getCurrentExercise, installCurrentExercise } from "@/repositories/ExerciseRepository";
import { NARVA_TRAUMA_EXERCISE_PACKAGE } from "@/services/exercise/NarvaExercisePackages";
import { exercisePackageLoader, getExercisePackage } from "@/services/exercise/ExercisePackageService";
import {
  acceptRuntimeReaderCheckpoint,
  advertiseRuntimeReaderCheckpoint,
  beginRuntimeReaderConvergence,
  resetRuntimeReaderConvergence,
  runtimeReaderCommandReadiness,
  setRuntimeReaderConvergenceUnavailable,
} from "../RuntimeReaderConvergenceService";

const exerciseId = "EX-CM-READINESS-RECONCILIATION";

function checkpoint(revision = 17, simulationTimeSec = 420): RuntimeCheckpointEnvelope<SharedExerciseState> {
  return Object.freeze({
    exerciseId,
    checkpointRevision: revision,
    payloadHash: `HASH-${revision}`,
    provenanceHash: `PROVENANCE-${revision}`,
    persistedRuntimeVersion: 1,
    payload: {
      exerciseSession: {
        exerciseId,
        lifecycleState: "RUNNING",
        simulationTimeSec,
        speed: 1,
        version: revision,
        clockVersion: 2,
        clockInitializedAtSimulationTimeSec: 0,
      },
    },
  }) as RuntimeCheckpointEnvelope<SharedExerciseState>;
}

describe("CM reader command-readiness reconciliation", () => {
  const previousExercise = { ...getCurrentExercise() };
  const previousPackage = getExercisePackage(previousExercise.id);

  afterEach(() => {
    resetRuntimeReaderConvergence();
    exercisePackageLoader.unbind(exerciseId);
    installCurrentExercise(previousExercise.id, previousExercise.name, previousPackage);
  });

  test("READINESS-G01/G02/G03/G04: identical canonical package hydration cannot invalidate a ready reader", () => {
    installCurrentExercise(exerciseId, exerciseId, NARVA_TRAUMA_EXERCISE_PACKAGE);
    beginRuntimeReaderConvergence(exerciseId);
    acceptRuntimeReaderCheckpoint(checkpoint(), "REMOTE");
    expect(runtimeReaderCommandReadiness(exerciseId, 420)).toEqual({ ready: true });

    let bindingInvalidations = 0;
    const stop = exercisePackageLoader.subscribeToBindings(() => {
      bindingInvalidations += 1;
      beginRuntimeReaderConvergence(exerciseId);
    });
    installCurrentExercise(exerciseId, exerciseId, NARVA_TRAUMA_EXERCISE_PACKAGE);
    stop();

    expect(bindingInvalidations).toBe(0);
    expect(runtimeReaderCommandReadiness(exerciseId, 420)).toEqual({ ready: true });
  });

  test("READINESS-G02/G06/G08: genuine disconnect remains closed and authoritative reconnect clears it", () => {
    beginRuntimeReaderConvergence(exerciseId);
    acceptRuntimeReaderCheckpoint(checkpoint(), "REMOTE");
    setRuntimeReaderConvergenceUnavailable(exerciseId, "AUTHORITY_UNAVAILABLE");
    expect(runtimeReaderCommandReadiness(exerciseId, 420)).toMatchObject({ ready: false });

    acceptRuntimeReaderCheckpoint(checkpoint(), "REMOTE");
    expect(runtimeReaderCommandReadiness(exerciseId, 420)).toEqual({ ready: true });
  });

  test("READINESS-G04/G07: newer writer generation fences until its checkpoint is accepted", () => {
    beginRuntimeReaderConvergence(exerciseId);
    acceptRuntimeReaderCheckpoint(checkpoint(), "REMOTE");
    advertiseRuntimeReaderCheckpoint({ exerciseId, checkpointRevision: 18, payloadHash: "HASH-18",
      provenanceHash: "PROVENANCE-18", writerInstanceId: "WRITER-B" });
    expect(runtimeReaderCommandReadiness(exerciseId, 420)).toMatchObject({ ready: false });

    acceptRuntimeReaderCheckpoint(checkpoint(18, 425), "REMOTE");
    expect(runtimeReaderCommandReadiness(exerciseId, 425)).toEqual({ ready: true });
  });

  test("READINESS-G09: a converged reader cannot reuse readiness for another exercise", () => {
    beginRuntimeReaderConvergence(exerciseId);
    acceptRuntimeReaderCheckpoint(checkpoint(), "REMOTE");
    expect(runtimeReaderCommandReadiness("EX-OTHER", 420)).toMatchObject({ ready: false });
  });
});
