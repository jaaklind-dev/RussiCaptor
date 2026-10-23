import "expo-sqlite/localStorage/install";
import { sha256Text } from "@/utils/sha256";
import type { ExerciseBootstrapAuthorization } from "@/services/admin/PlatformAdminService";

type Binding = Readonly<{ userId: string; packageId: string; packageVersion: string; packageHash: string; purpose: "ADMIN" | "CREATE" }>;
export type CreationReceipt = Binding & Readonly<{ version: 1; operationId: string; bootstrap?: ExerciseBootstrapAuthorization }>;
export type CreationJournal = Readonly<{
  begin(binding: Binding, operationId: string): CreationReceipt;
  bind(receipt: CreationReceipt, bootstrap: ExerciseBootstrapAuthorization): void;
  complete(receipt: CreationReceipt): void;
}>;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
/** Only operation and authority-row metadata. Never passwords, tokens, payloads
 * or projections. A failed durable write prevents starting allocation. */
export function createExerciseCreationJournal(storage: () => Storage): CreationJournal {
  const key = (b: Binding) => `russicaptor.pendingExerciseCreation.v1.${sha256Text(JSON.stringify([b.userId, b.packageId, b.packageVersion, b.purpose]))}`;
  const parse = (raw: string, binding: Binding): CreationReceipt => {
    const r = JSON.parse(raw) as CreationReceipt;
    if (!r || r.version !== 1 || typeof r.operationId !== "string" || !r.operationId.length
      || r.operationId.length > 200 || Object.keys(r).some(k => !["version", "operationId", "bootstrap", "userId", "packageId", "packageVersion", "packageHash", "purpose"].includes(k))
      || r.userId !== binding.userId || r.packageId !== binding.packageId || r.packageVersion !== binding.packageVersion
      || r.packageHash !== binding.packageHash || r.purpose !== binding.purpose
      || (r.bootstrap && (r.bootstrap.user_id !== binding.userId || typeof r.bootstrap.id !== "string"
        || r.bootstrap.status !== "ACTIVE" || typeof r.bootstrap.expires_at !== "string"))) {
      throw new Error("EXERCISE_CREATION_JOURNAL_INVALID");
    }
    return r;
  };
  const write = (r: CreationReceipt) => {
    const value = JSON.stringify(r); const s = storage(); s.setItem(key(r), value);
    if (s.getItem(key(r)) !== value) throw new Error("EXERCISE_CREATION_JOURNAL_WRITE_FAILED");
  };
  return {
    begin(binding, operationId) {
      const raw = storage().getItem(key(binding));
      if (raw !== null) return parse(raw, binding);
      const receipt: CreationReceipt = { ...binding, version: 1, operationId };
      parse(JSON.stringify(receipt), binding); write(receipt); return receipt;
    },
    bind(receipt, bootstrap) {
      const raw = storage().getItem(key(receipt));
      if (raw === null) throw new Error("EXERCISE_CREATION_JOURNAL_MISSING");
      const current = parse(raw, receipt);
      if (current.operationId !== receipt.operationId || (current.bootstrap && current.bootstrap.id !== bootstrap.id)) {
        throw new Error("EXERCISE_CREATION_JOURNAL_CONFLICT");
      }
      const safeBootstrap: ExerciseBootstrapAuthorization = { id: bootstrap.id, user_id: bootstrap.user_id,
        status: bootstrap.status, expires_at: bootstrap.expires_at, consumed_exercise_id: bootstrap.consumed_exercise_id };
      const next = { ...current, bootstrap: safeBootstrap }; parse(JSON.stringify(next), receipt); write(next);
    },
    complete(receipt) {
      const raw = storage().getItem(key(receipt));
      if (raw === null || parse(raw, receipt).operationId !== receipt.operationId) throw new Error("EXERCISE_CREATION_JOURNAL_CONFLICT");
      storage().removeItem(key(receipt));
      if (storage().getItem(key(receipt)) !== null) throw new Error("EXERCISE_CREATION_JOURNAL_WRITE_FAILED");
    },
  };
}
export const exerciseCreationJournal = createExerciseCreationJournal(() => {
  if (!globalThis.localStorage) throw new Error("EXERCISE_CREATION_STORAGE_UNAVAILABLE");
  return globalThis.localStorage;
});
