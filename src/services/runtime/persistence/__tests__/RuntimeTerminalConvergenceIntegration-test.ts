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
  });

  test("terminal publication uses the atomic finalizer and stops both heartbeat transports", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    expect(source).toContain("repository.finalizeCompletion!");
    expect(source).toContain('renewalLoop?.stop("TERMINAL_COMPLETION")');
    expect(source).toContain('stopNativeHeartbeat("TERMINAL_COMPLETION")');
    expect(source).toContain('setRuntimeWriterAuthorityState("READER")');
    expect(source).not.toMatch(/terminalAuthorityFinalizer[\s\S]{0,300}releaseWriter/);
  });

  test("CloudSync cannot publish terminal projection outside the fenced checkpoint transaction", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/services/CloudSyncService.ts"), "utf8");
    expect(source).toContain("terminalProjectionOwnedByCheckpointProtocol(exerciseId)");
    expect(source.indexOf("terminalProjectionOwnedByCheckpointProtocol(exerciseId)")).toBeLessThan(source.indexOf("withTerminalExerciseArchive(baseProjection"));
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
