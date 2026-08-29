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

const unauthenticated: CaseManager = { id: "UNAUTHENTICATED", name: "Autentimata" };
export const demoCaseManagers = __DEV__ ? [jaak, demoTransferTarget] : [];

let currentCaseManager: CaseManager = { ...(__DEV__ ? jaak : unauthenticated) };
let authenticatedCaseManager = false;

export function getCurrentCaseManager(): CaseManager {
  return currentCaseManager;
}

export function setCurrentCaseManager(caseManager: CaseManager): void {
  if (!__DEV__ || authenticatedCaseManager) return;
  currentCaseManager = { ...caseManager };
  notifySync("device");
}

export function resetCurrentCaseManager(): void {
  if (authenticatedCaseManager) return;
  currentCaseManager = { ...(__DEV__ ? jaak : unauthenticated) };
}

export function restoreCurrentCaseManager(caseManager: CaseManager): void {
  if (authenticatedCaseManager) return;
  const knownCaseManager = demoCaseManagers.find(
    (candidate) => candidate.id === caseManager.id
  );

  currentCaseManager = { ...(knownCaseManager ?? caseManager) };
}

export function setAuthenticatedCaseManager(caseManager: CaseManager): void {
  currentCaseManager = { ...caseManager };
  authenticatedCaseManager = true;
  notifySync("device");
}
