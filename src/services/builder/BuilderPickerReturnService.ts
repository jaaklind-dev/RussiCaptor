import "expo-sqlite/localStorage/install";
import type { ExerciseBuilderDraft } from "@/models/builder/ExerciseBuilderDraft";

export type BuilderSection = "Üldandmed" | "Patsiendid" | "Näitajad" | "Labor" | "Pildiuuringud" | "Ülevaade";
export type BuilderPickerReturn = Readonly<{
  operationId: string;
  userId: string;
  startedAt: number;
  status: "PENDING" | "IMPORTED" | "CANCELLED" | "ERROR";
  draft: ExerciseBuilderDraft;
  section: BuilderSection;
  patientId?: string;
  studyId: string;
  dirty: boolean;
  notice?: string;
}>;

const prefix = "russicaptor.builder.picker-return.v1.";
const maxAgeMs = 30 * 60 * 1000;
const listeners = new Set<() => void>();
let version = 0;
const storage = () => globalThis.localStorage;
const notify = () => { version += 1; listeners.forEach(listener => listener()); };

export function getBuilderPickerReturnVersion(): number { return version; }
export function subscribeBuilderPickerReturn(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** This local checkpoint is separate from the user's saved-draft list. */
export function readBuilderPickerReturn(userId: string): BuilderPickerReturn | undefined {
  if (!userId) return undefined;
  try {
    const value: unknown = JSON.parse(storage()?.getItem(`${prefix}${userId}`) ?? "null");
    if (!value || typeof value !== "object") return undefined;
    const item = value as BuilderPickerReturn;
    if (item.userId !== userId || typeof item.operationId !== "string" ||
      !["PENDING", "IMPORTED", "CANCELLED", "ERROR"].includes(item.status) ||
      !Number.isFinite(item.startedAt) || Date.now() - item.startedAt > maxAgeMs ||
      typeof item.studyId !== "string" || !Array.isArray(item.draft?.patients) ||
      !Array.isArray(item.draft?.studies)) return undefined;
    return item;
  } catch { return undefined; }
}

export function beginBuilderPickerReturn(context: Omit<BuilderPickerReturn, "operationId" | "startedAt" | "status" | "notice">): BuilderPickerReturn {
  if (!context.userId || !context.studyId || !context.draft.studies.some(item => item.id === context.studyId)) {
    throw new Error("BUILDER_PICKER_CONTEXT_INVALID");
  }
  const item: BuilderPickerReturn = { ...context, draft: structuredClone(context.draft),
    operationId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, startedAt: Date.now(), status: "PENDING" };
  const store = storage();
  if (!store) throw new Error("BUILDER_PICKER_CHECKPOINT_UNAVAILABLE");
  store.setItem(`${prefix}${item.userId}`, JSON.stringify(item));
  notify();
  return item;
}

/** A repeated native callback cannot import the same selected asset twice. */
export function settleBuilderPickerReturn(userId: string, operationId: string,
  outcome: Pick<BuilderPickerReturn, "status" | "draft" | "notice">): BuilderPickerReturn | undefined {
  const current = readBuilderPickerReturn(userId);
  if (!current || current.operationId !== operationId || current.status !== "PENDING" || outcome.status === "PENDING") {
    return undefined;
  }
  const next = { ...current, ...outcome, dirty: outcome.status === "IMPORTED" ? true : current.dirty,
    draft: structuredClone(outcome.draft) };
  const store = storage();
  if (!store) throw new Error("BUILDER_PICKER_CHECKPOINT_UNAVAILABLE");
  store.setItem(`${prefix}${userId}`, JSON.stringify(next));
  notify();
  return next;
}

export function clearBuilderPickerReturn(userId: string): void {
  if (!userId) return;
  storage()?.removeItem(`${prefix}${userId}`);
  notify();
}

export function shouldRestoreBuilderRoute(path: string, isAuthorizedAdmin: boolean,
  context: BuilderPickerReturn | undefined): boolean {
  return isAuthorizedAdmin && Boolean(context) && path === "admin";
}
