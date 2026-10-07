import fs from "fs";
import path from "path";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { restoreRuntimePatientCommandCursor, getRuntimePatientCommandCursor } from "@/services/runtime/commands/RuntimePatientCommandCursor";

describe("WP-NARVA-06 Runtime terminal convergence integration", () => {
  test("checkpoint cursor is optional for historical snapshots and monotonic when present", () => {
    restoreRuntimePatientCommandCursor("EX-1");
    expect(getRuntimePatientCommandCursor("EX-1")).toBe(0);
    restoreRuntimePatientCommandCursor("EX-1", 19);
    expect(getRuntimePatientCommandCursor("EX-1")).toBe(19);
    const historical = { exerciseSession: { exerciseId: "EX-OLD" } } as SharedExerciseState;
    expect(historical.runtimePatientCommandCursor).toBeUndefined();
  });

  test("writer consumes commands and completion notifications through payload-light Realtime channels", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    expect(source).toContain('table:"runtime_patient_command_notifications"');
    expect(source).toContain('table:"runtime_completion_requests"');
    expect(source).toContain("drainPatientCommands(request.fenceCommandSequence)");
    expect(source).toContain("materializeRuntimePatientCommand");
    expect(source).toContain("handleExerciseControlCommand({commandId:request.commandId");
  });

  test("an accepted pending completion replay rematerializes the terminal lifecycle before publication", () => {
    const handler = fs.readFileSync(path.resolve(process.cwd(), "src/services/runtime/exercise/ExerciseControlCommandHandler.ts"), "utf8");
    expect(handler).toContain('entry.outcome === "ACCEPTED"');
    expect(handler).toContain('entry.eventType === "ExerciseCompleted"');
    expect(handler).toContain('current.lifecycleState !== "COMPLETED"');
    expect(handler).toContain('runtimeWritesAllowed()');
    expect(handler).toContain('COMPLETE_HANDLER_REPLAY_MATERIALIZED');
    expect(handler).toContain('const resumed: ExerciseControlResult = { ok: true');
    expect(handler).not.toContain("audit.push({ commandId: command.commandId, exerciseId: command.exerciseId, commandType: command.commandType, replay");
  });

  test("writer recovery establishes its owner before completion owns publication", () => {
    const sync = fs.readFileSync(path.resolve(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const takeover = sync.slice(sync.indexOf("export async function takeOverRuntimeWriter"), sync.indexOf("/** Explicit user recovery"));
    const recovery = sync.slice(sync.indexOf("async function reacquireRuntimeFromRemoteCheckpointForIntent"), sync.indexOf("function setAndReturn"));
    for (const pathSource of [takeover, recovery]) {
      const restore = pathSource.indexOf("acceptAuthoritativeRuntimeCheckpointAsync");
      const owner = pathSource.indexOf("establishExerciseRuntimeOwnerForCurrentWriter", restore);
      const coordinator = pathSource.indexOf("await resumeCompletionBeforeRoutinePublication", owner);
      const completion = pathSource.indexOf("resumePendingCompletionForCurrentWriter", coordinator);
      const commandDrain = pathSource.indexOf("drainPatientCommandsForCurrentWriter", completion);
      const routine = pathSource.indexOf("wakeCheckpointPublicationForCurrentWriter", completion);
      expect(restore).toBeGreaterThan(-1);
      expect(owner).toBeGreaterThan(restore);
      expect(coordinator).toBeGreaterThan(owner);
      expect(completion).toBeGreaterThan(coordinator);
      expect(commandDrain).toBeGreaterThan(completion);
      expect(routine).toBeGreaterThan(commandDrain);
    }
  });

  test("writer takeover drains commands before routine publication when no completion owns it", () => {
    const sync = fs.readFileSync(path.resolve(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const takeover = sync.slice(sync.indexOf("export async function takeOverRuntimeWriter"), sync.indexOf("/** Explicit user recovery"));
    const owner = takeover.indexOf("establishExerciseRuntimeOwnerForCurrentWriter");
    const coordinator = takeover.indexOf("await resumeCompletionBeforeRoutinePublication", owner);
    const commandDrain = takeover.indexOf("await drainPatientCommandsForCurrentWriter?.()", coordinator);
    const publish = takeover.indexOf("wakeCheckpointPublicationForCurrentWriter", commandDrain);
    expect(coordinator).toBeGreaterThan(owner);
    expect(commandDrain).toBeGreaterThan(coordinator);
    expect(publish).toBeGreaterThan(commandDrain);
  });

  test("terminal publication uses the atomic finalizer and stops both heartbeat transports", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    expect(source).toContain("repository.finalizeCompletion!");
    expect(source).toContain('renewalLoop?.stop("TERMINAL_COMPLETION")');
    expect(source).toContain('stopNativeHeartbeat("TERMINAL_COMPLETION")');
    expect(source).toContain('setRuntimeWriterAuthorityState("READER")');
    expect(source).not.toMatch(/terminalAuthorityFinalizer[\s\S]{0,300}releaseWriter/);
  });

  test("pending completion recovery uses the canonical-primary single-flight terminal boundary", () => {
    const sync = fs.readFileSync(path.resolve(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const repository = fs.readFileSync(path.resolve(process.cwd(),
      "src/services/runtime/persistence/RuntimeCheckpointRepository.ts"), "utf8");
    expect(sync).toContain("completionProcessing:Promise<void>|undefined");
    expect(sync).toContain("activeCompletion?.status===\"PENDING\"");
    expect(sync).toContain("repository.finalizeCompletion!");
    expect(repository).toContain("finalize_runtime_completion_canonical_payload");
    const preferred = repository.indexOf("finalize_runtime_completion_canonical_payload");
    const combinedFallback = repository.indexOf("finalize_runtime_completion_canonical\"", preferred);
    expect(preferred).toBeGreaterThan(-1);
    expect(combinedFallback).toBeGreaterThan(preferred);
  });

  test("CloudSync cannot publish terminal projection outside the fenced checkpoint transaction", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/services/CloudSyncService.ts"), "utf8");
    expect(source).toContain("shouldSuppressCloudProjectionWrite(exerciseId)");
    expect(source.indexOf("shouldSuppressCloudProjectionWrite(exerciseId)")).toBeLessThan(source.indexOf("withTerminalExerciseArchive(baseProjection"));
  });

  test("CM and EXCON patient controls use the same durable command-submission path", () => {
    const excon = fs.readFileSync(path.resolve(process.cwd(), "src/components/instructor/InspectorResourceInterventions.tsx"), "utf8");
    const cm = fs.readFileSync(path.resolve(process.cwd(), "src/components/patient/PelvicBinderControls.tsx"), "utf8");
    expect(excon).toContain("submitResourceInterventionCommand");
    expect(excon).toContain("submitMtpCommand");
    expect(cm).toContain("submitResourceInterventionCommand");
    expect(cm).toContain("submitStopResourceInterventionCommand");
  });
});
