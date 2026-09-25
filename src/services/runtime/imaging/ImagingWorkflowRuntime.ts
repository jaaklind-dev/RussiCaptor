import { IMAGING_WORKFLOW_SCHEMA_VERSION, type ImagingOrderDefinitionSnapshot,
  type ImagingStudyInstance, type ImagingWorkflowSnapshot } from "@/models/ImagingWorkflow";
import { deepFreeze, immutableClone } from "@/utils/immutable";
import { stableJson } from "@/utils/stableJson";

const empty = (): ImagingWorkflowSnapshot => deepFreeze({
  schemaVersion: IMAGING_WORKFLOW_SCHEMA_VERSION, instances: [],
});
const validTime = (value: number): void => {
  if (!Number.isFinite(value) || value < 0) throw new Error("IMAGING_INVALID_SIMULATION_TIME");
};

/** Authoritative, checkpoint-owned Imaging lifecycle. It contains instances, never package definitions. */
export class ImagingWorkflowRuntime {
  private state: ImagingWorkflowSnapshot = empty();
  constructor(private readonly mutationAllowed: () => boolean = () => true) {}

  reset(): void { this.state = empty(); }
  snapshot(): ImagingWorkflowSnapshot { return immutableClone(this.state) as ImagingWorkflowSnapshot; }

  order(input: Readonly<{ commandId: string; exerciseId: string; patientId: string; orderedBy: string;
    orderedAtSimulationTimeSec: number; definition: ImagingOrderDefinitionSnapshot }>): ImagingStudyInstance {
    this.assertMutable(); validTime(input.orderedAtSimulationTimeSec);
    if (input.patientId !== input.definition.patientId || input.definition.delaySeconds < 0 ||
      !Number.isFinite(input.definition.delaySeconds)) throw new Error("IMAGING_DEFINITION_SCOPE_DENIED");
    const imagingInstanceId = `IMAGING:${input.commandId}`;
    const duplicate = this.state.instances.find(item => item.imagingInstanceId === imagingInstanceId ||
      item.orderCommandId === input.commandId);
    if (duplicate) {
      if (duplicate.exerciseId !== input.exerciseId || duplicate.patientId !== input.patientId ||
        duplicate.definitionId !== input.definition.definitionId ||
        duplicate.orderedAtSimulationTimeSec !== input.orderedAtSimulationTimeSec) {
        throw new Error("IMAGING_ORDER_IDEMPOTENCY_CONFLICT");
      }
      return immutableClone(duplicate) as ImagingStudyInstance;
    }
    const repeatOrdinal = this.state.instances.filter(item =>
      item.definitionId === input.definition.definitionId).length + 1;
    const instance = deepFreeze({ imagingInstanceId, orderCommandId: input.commandId,
      exerciseId: input.exerciseId, patientId: input.patientId,
      definitionId: input.definition.definitionId, packageId: input.definition.packageId,
      packageVersion: input.definition.packageVersion, packageHash: input.definition.packageHash,
      title: input.definition.title, modality: input.definition.modality, orderedBy: input.orderedBy,
      orderedAtSimulationTimeSec: input.orderedAtSimulationTimeSec,
      availableAtSimulationTimeSec: input.orderedAtSimulationTimeSec + input.definition.delaySeconds,
      repeatOrdinal, status: "ORDERED" as const, authoredSource: {
        report: input.definition.reportSource,
        ...(input.definition.attachment ? { attachment: input.definition.attachment } : {}),
      },
    });
    this.replace({ ...this.state, instances: [...this.state.instances, instance] });
    return immutableClone(instance) as ImagingStudyInstance;
  }

  advanceTo(simulationTimeSec: number): readonly ImagingStudyInstance[] {
    validTime(simulationTimeSec);
    if (!this.mutationAllowed() || this.state.terminalFencedAtSimulationTimeSec !== undefined) return [];
    const changed: ImagingStudyInstance[] = [];
    const instances = this.state.instances.map(item => {
      if (item.status === "RESULTED") return item;
      if (simulationTimeSec < item.availableAtSimulationTimeSec) {
        if (item.status === "PROCESSING") return item;
        const processing = deepFreeze({ ...item, status: "PROCESSING" as const,
          processingStartedAtSimulationTimeSec: simulationTimeSec });
        changed.push(processing); return processing;
      }
      const resulted = deepFreeze({ ...item, status: "RESULTED" as const,
        processingStartedAtSimulationTimeSec: item.processingStartedAtSimulationTimeSec ?? item.orderedAtSimulationTimeSec,
        result: { report: item.authoredSource.report,
          ...(item.authoredSource.attachment ? { attachment: item.authoredSource.attachment } : {}),
          releasedAtSimulationTimeSec: simulationTimeSec } });
      changed.push(resulted); return resulted;
    });
    if (changed.length) this.replace({ ...this.state, instances });
    return immutableClone(changed) as readonly ImagingStudyInstance[];
  }

  restore(value?: ImagingWorkflowSnapshot): void {
    if (!value) { this.reset(); return; }
    const candidate = immutableClone(value) as ImagingWorkflowSnapshot;
    this.validate(candidate); this.state = candidate;
  }

  fenceTerminal(simulationTimeSec: number): void {
    validTime(simulationTimeSec);
    if (this.state.terminalFencedAtSimulationTimeSec === undefined) {
      this.replace({ ...this.state, terminalFencedAtSimulationTimeSec: simulationTimeSec });
    }
  }

  private assertMutable(): void {
    if (!this.mutationAllowed()) throw new Error("IMAGING_WRITER_REQUIRED");
    if (this.state.terminalFencedAtSimulationTimeSec !== undefined) throw new Error("IMAGING_TERMINAL_FENCED");
  }
  private replace(value: ImagingWorkflowSnapshot): void {
    this.state = immutableClone(value) as ImagingWorkflowSnapshot;
  }
  private validate(value: ImagingWorkflowSnapshot): void {
    if (value.schemaVersion !== IMAGING_WORKFLOW_SCHEMA_VERSION) throw new Error("IMAGING_UNSUPPORTED_SCHEMA");
    const ids = new Set<string>(); const commands = new Set<string>();
    for (const item of value.instances) {
      if (!item.imagingInstanceId || !item.orderCommandId || !item.exerciseId || !item.patientId ||
        !item.definitionId || !item.packageId || !item.packageVersion || !item.packageHash ||
        !item.authoredSource?.report ||
        ids.has(item.imagingInstanceId) || commands.has(item.orderCommandId) || item.repeatOrdinal < 1 ||
        !Number.isInteger(item.repeatOrdinal) || !["ORDERED", "PROCESSING", "RESULTED"].includes(item.status)) {
        throw new Error("IMAGING_INVALID_INSTANCE");
      }
      validTime(item.orderedAtSimulationTimeSec); validTime(item.availableAtSimulationTimeSec);
      if (item.availableAtSimulationTimeSec < item.orderedAtSimulationTimeSec ||
        (item.status === "RESULTED") !== Boolean(item.result) ||
        (item.result && item.result.releasedAtSimulationTimeSec < item.availableAtSimulationTimeSec)) {
        throw new Error("IMAGING_INVALID_INSTANCE");
      }
      ids.add(item.imagingInstanceId); commands.add(item.orderCommandId);
    }
    const ordinals = value.instances.map(item => `${item.definitionId}:${item.repeatOrdinal}`);
    if (new Set(ordinals).size !== ordinals.length) throw new Error("IMAGING_DUPLICATE_REPEAT_ORDINAL");
    if (value.terminalFencedAtSimulationTimeSec !== undefined) validTime(value.terminalFencedAtSimulationTimeSec);
    // Ensures clone did not normalize any data silently.
    if (stableJson(value) !== stableJson(immutableClone(value))) throw new Error("IMAGING_INVALID_SNAPSHOT");
  }
}
