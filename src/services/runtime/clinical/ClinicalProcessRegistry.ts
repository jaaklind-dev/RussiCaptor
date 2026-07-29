import type { ClinicalIntegrationInput, ClinicalProcessHandler, ClinicalProcessRuntime } from "@/models/ClinicalIntegration";

export class ClinicalProcessRegistry {
  private readonly handlers = new Map<string, ClinicalProcessHandler>();

  constructor(handlers: ClinicalProcessHandler[] = []) {
    handlers.forEach(handler => this.register(handler));
  }

  register(handler: ClinicalProcessHandler): void {
    if (!handler.processType) throw new Error("ClinicalProcessHandler processType puudub.");
    if (this.handlers.has(handler.processType)) {
      throw new Error(`ClinicalProcessHandler ${handler.processType} esineb mitu korda.`);
    }
    this.handlers.set(handler.processType, handler);
  }

  resolve(input: ClinicalIntegrationInput, processes: ClinicalProcessRuntime[]): {
    handler: ClinicalProcessHandler; process: ClinicalProcessRuntime;
  }[] {
    return processes
      .filter(process => process.state !== "Resolved")
      .flatMap(process => {
        const handler = this.handlers.get(process.processType);
        return handler?.accepts(input, process) ? [{ handler, process }] : [];
      })
      .sort((a, b) =>
        a.process.processType.localeCompare(b.process.processType) ||
        a.process.processId.localeCompare(b.process.processId) ||
        a.process.instanceKey.localeCompare(b.process.instanceKey)
      );
  }
}
