import { createExerciseCreationJournal } from "../ExerciseCreationJournal";
const binding = { userId: "ACTOR", packageId: "PKG", packageVersion: "1", packageHash: "a".repeat(64), purpose: "CREATE" as const };
const token = { id: "BOOT", user_id: "ACTOR", status: "ACTIVE" as const, consumed_exercise_id: null, expires_at: "2099-01-01T00:00:00Z" };
function fixture() {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
  return { data, storage, journal: createExerciseCreationJournal(() => storage) };
}
test("restart/remount retains exact operation and bootstrap instead of allocating another", () => {
  const f = fixture(); const r = f.journal.begin(binding, "OLD-OP"); f.journal.bind(r, token);
  const restarted = createExerciseCreationJournal(() => f.storage);
  expect(restarted.begin(binding, "NEW-UI-OP")).toMatchObject({ operationId: "OLD-OP", bootstrap: token });
});
test("different actor has isolated journal", () => {
  const f = fixture(); f.journal.begin(binding, "A");
  expect(f.journal.begin({ ...binding, userId: "OTHER" }, "B").operationId).toBe("B");
});
test("package hash drift and unknown schema fail closed", () => {
  const f = fixture(); f.journal.begin(binding, "A");
  expect(() => f.journal.begin({ ...binding, packageHash: "b".repeat(64) }, "B")).toThrow("JOURNAL_INVALID");
  const key = [...f.data.keys()][0]; f.data.set(key, JSON.stringify({ ...binding, version: 2, operationId: "A" }));
  expect(() => f.journal.begin(binding, "B")).toThrow("JOURNAL_INVALID");
});
test("wrong actor/token replacement cannot change immutable binding", () => {
  const f = fixture(); const r = f.journal.begin(binding, "A");
  expect(() => f.journal.bind(r, { ...token, user_id: "OTHER" })).toThrow("JOURNAL_INVALID");
  f.journal.bind(r, token);
  expect(() => f.journal.bind(r, { ...token, id: "NEW" })).toThrow("JOURNAL_CONFLICT");
});
test("storage write failure cannot silently create an ephemeral operation", () => {
  const journal = createExerciseCreationJournal(() => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }));
  expect(() => journal.begin(binding, "A")).toThrow("WRITE_FAILED");
});
test("complete removes only the matching operation and permits a new future operation", () => {
  const f = fixture(); const r = f.journal.begin(binding, "A");
  expect(() => f.journal.complete({ ...r, operationId: "OTHER" })).toThrow("JOURNAL_CONFLICT");
  f.journal.complete(r); expect(f.journal.begin(binding, "B").operationId).toBe("B");
});
test("journal never serializes clinical payloads or credentials", () => {
  const f = fixture(); const r = f.journal.begin(binding, "A"); f.journal.bind(r, token);
  expect(Object.keys(JSON.parse([...f.data.values()][0])).sort()).toEqual(["bootstrap", "operationId", "packageHash", "packageId", "packageVersion", "purpose", "userId", "version"]);
});
