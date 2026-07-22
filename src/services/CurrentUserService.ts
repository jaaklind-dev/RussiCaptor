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
  notifySync("device");
}

export function resetCurrentCaseManager(): void {
  currentCaseManager = { ...jaak };
}

export function restoreCurrentCaseManager(caseManager: CaseManager): void {
  const knownCaseManager = demoCaseManagers.find(
    (candidate) => candidate.id === caseManager.id
  );

  currentCaseManager = { ...(knownCaseManager ?? caseManager) };
}
