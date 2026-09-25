import { IMAGING_WORKFLOW_SCHEMA_VERSION, type ImagingOrderDefinitionSnapshot,
  type ImagingStudyInstance, type ImagingWorkflowSnapshot } from "@/models/ImagingWorkflow";
import { deepFreeze, immutableClone } from "@/utils/immutable";
import { stableJson } from "@/utils/stableJson";
import { sha256Text } from "@/utils/sha256";
import { adaptLegacyImagingAttachment, validateImagingAssetReference } from "@/services/imaging/ImagingAssetRegistry";

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
    if (input.definition.asset) validateImagingAssetReference(input.definition.asset);
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
        reportText: input.definition.reportSource,
        reportSha256: sha256Text(input.definition.reportSource),
        ...(input.definition.asset ? { asset: input.definition.asset } : {}),
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
        result: { resultId: `IMAGING_RESULT:${item.imagingInstanceId}`,
          imagingInstanceId: item.imagingInstanceId, patientId: item.patientId,
          definitionId: item.definitionId, packageId: item.packageId, packageVersion: item.packageVersion,
          packageHash: item.packageHash, reportText: item.authoredSource.reportText,
          authoredReportSha256: item.authoredSource.reportSha256,
          ...(item.authoredSource.asset ? { asset: item.authoredSource.asset } : {}),
          releasedAtSimulationTimeSec: simulationTimeSec } });
      changed.push(resulted); return resulted;
    });
    if (changed.length) this.replace({ ...this.state, instances });
    return immutableClone(changed) as readonly ImagingStudyInstance[];
  }

  restore(value?: ImagingWorkflowSnapshot): void {
    if (!value) { this.reset(); return; }
    const candidate = this.upgradeLegacySnapshot(value as unknown as Record<string, unknown>);
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
        !item.authoredSource?.reportText || item.authoredSource.reportSha256 !== sha256Text(item.authoredSource.reportText) ||
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
      if (item.authoredSource.asset) validateImagingAssetReference(item.authoredSource.asset);
      if (item.result && (item.result.resultId !== `IMAGING_RESULT:${item.imagingInstanceId}` ||
        item.result.imagingInstanceId !== item.imagingInstanceId || item.result.patientId !== item.patientId ||
        item.result.definitionId !== item.definitionId || item.result.packageId !== item.packageId ||
        item.result.packageVersion !== item.packageVersion || item.result.packageHash !== item.packageHash ||
        item.result.reportText !== item.authoredSource.reportText ||
        item.result.authoredReportSha256 !== item.authoredSource.reportSha256 ||
        stableJson(item.result.asset) !== stableJson(item.authoredSource.asset))) throw new Error("IMAGING_INVALID_RESULT");
      ids.add(item.imagingInstanceId); commands.add(item.orderCommandId);
    }
    const ordinals = value.instances.map(item => `${item.definitionId}:${item.repeatOrdinal}`);
    if (new Set(ordinals).size !== ordinals.length) throw new Error("IMAGING_DUPLICATE_REPEAT_ORDINAL");
    if (value.terminalFencedAtSimulationTimeSec !== undefined) validTime(value.terminalFencedAtSimulationTimeSec);
    // Ensures clone did not normalize any data silently.
    if (stableJson(value) !== stableJson(immutableClone(value))) throw new Error("IMAGING_INVALID_SNAPSHOT");
  }

  private upgradeLegacySnapshot(value: Record<string, unknown>): ImagingWorkflowSnapshot {
    if (value.schemaVersion === IMAGING_WORKFLOW_SCHEMA_VERSION) {
      return immutableClone(value) as unknown as ImagingWorkflowSnapshot;
    }
    if (value.schemaVersion !== 1 || !Array.isArray(value.instances)) throw new Error("IMAGING_UNSUPPORTED_SCHEMA");
    const instances = value.instances.map(raw => {
      const item = raw as Record<string, any>;
      const legacySource = item.authoredSource ?? {};
      const reportText = legacySource.report;
      const asset = adaptLegacyImagingAttachment({ attachment: legacySource.attachment,
        packageId: item.packageId, definitionId: item.definitionId });
      if (legacySource.attachment && !asset) throw new Error("IMAGING_UNRESOLVED_LEGACY_ATTACHMENT");
      const authoredSource = { reportText, reportSha256: sha256Text(reportText), ...(asset ? { asset } : {}) };
      return { ...item, authoredSource, ...(item.result ? { result: {
        resultId: `IMAGING_RESULT:${item.imagingInstanceId}`, imagingInstanceId: item.imagingInstanceId,
        patientId: item.patientId, definitionId: item.definitionId, packageId: item.packageId,
        packageVersion: item.packageVersion, packageHash: item.packageHash, reportText: item.result.report,
        authoredReportSha256: sha256Text(item.result.report), ...(asset ? { asset } : {}),
        releasedAtSimulationTimeSec: item.result.releasedAtSimulationTimeSec,
      } } : {}) };
    });
    return immutableClone({ ...value, schemaVersion: IMAGING_WORKFLOW_SCHEMA_VERSION, instances }) as ImagingWorkflowSnapshot;
  }
}
