import type { CanonicalExerciseSnapshot } from "@/models/exercise/CanonicalExerciseSnapshot";
import type { PrincipalState } from "@/models/authorization/Authorization";

export type ExerciseRuntimeRecoveryErrorCode = "RECOVERY_NOT_REQUIRED" | "ACTIVE_RUNTIME_WRITER_PRESENT" | "RUNTIME_CHECKPOINT_AVAILABLE" | "RECOVERY_NOT_AUTHORIZED" | "INVALID_EXERCISE_LIFECYCLE" | "RECOVERY_BACKEND_FAILED" | "RECOVERY_CONFIRMATION_TIMEOUT";
export type ExerciseRuntimeRecoveryResult = Readonly<{ ok: true; snapshot: CanonicalExerciseSnapshot; auditId: string } | { ok: false; code: ExerciseRuntimeRecoveryErrorCode; message: string }>;
export type ExerciseRuntimeRecoveryCommand = Readonly<{ exerciseId: string; expectedVersion: number; persistenceFailure: "ACTIVE_RUNTIME_PERSISTENCE_MISSING" }>;
type Authorize = (state: PrincipalState, exerciseId: string) => Promise<boolean>;
export interface ExerciseRuntimeRecoveryRepository {
  terminate(command: ExerciseRuntimeRecoveryCommand): Promise<Readonly<{ snapshot: CanonicalExerciseSnapshot; auditId: string }> | Readonly<{ code: ExerciseRuntimeRecoveryErrorCode }>>;
}
const messages: Record<ExerciseRuntimeRecoveryErrorCode, string> = {
  RECOVERY_NOT_REQUIRED: "Runtime recovery termination is not required.", ACTIVE_RUNTIME_WRITER_PRESENT: "A healthy Runtime writer is still active.",
  RUNTIME_CHECKPOINT_AVAILABLE: "A recoverable Runtime checkpoint is available.", RECOVERY_NOT_AUTHORIZED: "EXCON Runtime recovery authorization is required.",
  INVALID_EXERCISE_LIFECYCLE: "Only a running or paused exercise can be recovery-terminated.", RECOVERY_BACKEND_FAILED: "Exercise recovery could not be completed safely.",
  RECOVERY_CONFIRMATION_TIMEOUT: "Exercise recovery did not reach a confirmed terminal state in time.",
};
export class ExerciseRuntimeRecoveryService {
  constructor(private readonly repository: ExerciseRuntimeRecoveryRepository, private readonly authorize: Authorize) {}
  async terminate(state: PrincipalState, command: ExerciseRuntimeRecoveryCommand): Promise<ExerciseRuntimeRecoveryResult> {
    if (!(await this.authorize(state, command.exerciseId))) return Object.freeze({ ok: false, code: "RECOVERY_NOT_AUTHORIZED", message: messages.RECOVERY_NOT_AUTHORIZED });
    try {
      const result = await this.repository.terminate(command);
      if ("code" in result) return Object.freeze({ ok: false, code: result.code, message: messages[result.code] });
      return Object.freeze({ ok: true, snapshot: Object.freeze({ ...result.snapshot }), auditId: result.auditId });
    } catch { return Object.freeze({ ok: false, code: "RECOVERY_BACKEND_FAILED", message: messages.RECOVERY_BACKEND_FAILED }); }
  }
}
