import type { RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import type { AcceptedRuntimePatientCommand, RuntimePatientCommandMaterialization,
  RuntimePatientCommandSubmission, RuntimePatientCommandSubmissionResult } from "@/models/RuntimePatientCommand";
import type { RuntimePatientCommandGateway } from "./RuntimePatientCommandService";

export type RuntimeCommandActor = Readonly<{ userId: string; role: "CM" | "EXCON"; exerciseIds: readonly string[] | "GLOBAL" }>;

export class InMemoryRuntimePatientCommandGateway implements RuntimePatientCommandGateway {
  private sequence = 0;
  private readonly heads = new Map<string, { revision: number; ownerUserId?: string }>();
  private readonly commands: AcceptedRuntimePatientCommand[] = [];
  private readonly results = new Map<number, RuntimePatientCommandMaterialization>();
  private readonly fenced = new Set<string>();
  constructor(private readonly actor: () => RuntimeCommandActor) {}
  private key(exerciseId: string, patientId: string): string { return `${exerciseId}\u0000${patientId}`; }
  seed(exerciseId: string, patientId: string, ownerUserId?: string, revision = 0): void {
    this.heads.set(this.key(exerciseId, patientId), { revision, ownerUserId });
  }
  transfer(exerciseId: string, patientId: string, ownerUserId: string): void {
    const head = this.heads.get(this.key(exerciseId, patientId));
    if (!head) throw new Error("PATIENT_NOT_FOUND");
    head.ownerUserId = ownerUserId; head.revision += 1;
  }
  fence(exerciseId: string): void { this.fenced.add(exerciseId); }
  accepted(): readonly AcceptedRuntimePatientCommand[] { return structuredClone(this.commands); }
  materialized(sequence: number): RuntimePatientCommandMaterialization | undefined { return this.results.get(sequence); }

  async submit(command: RuntimePatientCommandSubmission): Promise<RuntimePatientCommandSubmissionResult> {
    const actor = this.actor();
    if (actor.exerciseIds !== "GLOBAL" && !actor.exerciseIds.includes(command.exerciseId)) {
      return { status: "AUTHORIZATION_DENIED", patientRevision: command.patientBaseRevision };
    }
    const duplicate = this.commands.find(item => item.exerciseId === command.exerciseId && item.commandId === command.commandId);
    if (duplicate) {
      if (duplicate.actorUserId !== actor.userId || duplicate.patientId !== command.patientId ||
        duplicate.commandType !== command.commandType || JSON.stringify(duplicate.payload) !== JSON.stringify(command.payload)) {
        throw new Error("IDEMPOTENCY_KEY_REUSE");
      }
      return { status: "IDEMPOTENT", commandSequence: duplicate.commandSequence,
        patientRevision: duplicate.patientResultingRevision, ownerUserId: this.heads.get(this.key(command.exerciseId,command.patientId))?.ownerUserId };
    }
    const head = this.heads.get(this.key(command.exerciseId, command.patientId));
    if (!head) return { status: "UNAVAILABLE", patientRevision: 0 };
    if (this.fenced.has(command.exerciseId)) return { status: "COMPLETION_FENCED", patientRevision: head.revision, ownerUserId: head.ownerUserId };
    if (head.revision !== command.patientBaseRevision) return { status: "STALE_VERSION", patientRevision: head.revision, ownerUserId: head.ownerUserId };
    if (actor.role !== "EXCON" && head.ownerUserId !== actor.userId) return { status: "NOT_OWNER", patientRevision: head.revision, ownerUserId: head.ownerUserId };
    const accepted = Object.freeze({ ...structuredClone(command), commandSequence: ++this.sequence,
      patientResultingRevision: ++head.revision, actorUserId: actor.userId });
    this.commands.push(accepted);
    return { status: "APPLIED", commandSequence: accepted.commandSequence,
      patientRevision: accepted.patientResultingRevision, ownerUserId: head.ownerUserId };
  }
  async loadAfter(exerciseId: string, cursor: number, throughSequence?: number): Promise<readonly AcceptedRuntimePatientCommand[]> {
    return structuredClone(this.commands.filter(item => item.exerciseId === exerciseId && item.commandSequence > cursor &&
      (throughSequence === undefined || item.commandSequence <= throughSequence)).sort((a,b) => a.commandSequence-b.commandSequence));
  }
  async record(_exerciseId: string, commandSequence: number, _lease: RuntimeWriterLease,
    materialization: RuntimePatientCommandMaterialization): Promise<void> { this.results.set(commandSequence, structuredClone(materialization)); }
}
