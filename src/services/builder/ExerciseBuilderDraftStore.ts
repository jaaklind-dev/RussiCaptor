import "expo-sqlite/localStorage/install";
import type { ExerciseBuilderDraft } from "@/models/builder/ExerciseBuilderDraft";
import { getOperatorSession, hasPlatformAdminAuthority } from "@/services/authorization/OperatorSessionService";

const STORAGE_PREFIX = "russicaptor.builder.drafts.v1.";
export type DraftStorage = Readonly<{ getItem(key: string): string | null; setItem(key: string, value: string): void }>;
const defaultStorage: DraftStorage = { getItem: key => globalThis.localStorage?.getItem(key) ?? null,
  setItem: (key, value) => globalThis.localStorage?.setItem(key, value) };

export function builderDraftKey(draft: Pick<ExerciseBuilderDraft, "packageId" | "packageVersion">): string {
  return `${draft.packageId}@${draft.packageVersion}`;
}

/** Drafts are local, account-partitioned and never published as runtime packages. */
export class ExerciseBuilderDraftStore {
  constructor(private readonly storage: DraftStorage = defaultStorage) {}
  list(userId: string): readonly ExerciseBuilderDraft[] {
    let value: unknown;
    try { value = JSON.parse(this.storage.getItem(`${STORAGE_PREFIX}${userId}`) ?? "[]"); }
    catch { return []; }
    if (!Array.isArray(value)) return [];
    return value.filter(item => item?.schemaVersion === 1 && typeof item.packageId === "string" &&
      typeof item.packageVersion === "string") as ExerciseBuilderDraft[];
  }
  save(userId: string, draft: ExerciseBuilderDraft): void {
    if (!userId || !draft.packageId.trim() || !draft.packageVersion.trim()) throw new Error("BUILDER_DRAFT_IDENTITY_REQUIRED");
    const remaining = this.list(userId).filter(item => builderDraftKey(item) !== builderDraftKey(draft));
    const next = [...remaining, structuredClone(draft)].sort((a, b) => builderDraftKey(a).localeCompare(builderDraftKey(b)));
    this.storage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(next));
  }
}

export const builderDraftStore = new ExerciseBuilderDraftStore();

export function requireBuilderAdminUserId(): string {
  const session = getOperatorSession();
  if (session.state !== "AUTHENTICATED" || !hasPlatformAdminAuthority(session)) throw new Error("BUILDER_ADMIN_REQUIRED");
  return session.principal.userId;
}
