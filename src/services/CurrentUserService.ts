import type { CaseManager } from "@/models/CaseManager";
import { notifySync } from "@/services/SyncService";

const jaak: CaseManager = {
  id: "CM-001",
  name: "Jaak",
};

export const demoTransferTarget: CaseManager = {
  id: "CM-002",
  name: "Mari",
};

export const demoCaseManagers = [jaak, demoTransferTarget];

let currentCaseManager: CaseManager = { ...jaak };

export function getCurrentCaseManager(): CaseManager {
  return currentCaseManager;
}

export function setCurrentCaseManager(caseManager: CaseManager): void {
  currentCaseManager = { ...caseManager };
  notifySync();
}

export function resetCurrentCaseManager(): void {
  currentCaseManager = { ...jaak };
}
