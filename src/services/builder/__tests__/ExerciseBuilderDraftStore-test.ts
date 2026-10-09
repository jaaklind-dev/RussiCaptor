import { newBuilderDraft } from "../ExerciseBuilderService";
import { ExerciseBuilderDraftStore } from "../ExerciseBuilderDraftStore";

describe("Exercise Builder local draft persistence", () => {
  const values = new Map<string, string>();
  const store = new ExerciseBuilderDraftStore({ getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); } });
  beforeEach(() => values.clear());

  test("saves and restores an editable draft under the admin identity", () => {
    const draft = { ...newBuilderDraft(), packageId: "russicaptor.builder", packageVersion: "1.0.0",
      patients: [{ id: "PT-001", name: "Test", triage: "P2" as const, location: "ED",
        handover: "Test", vitals: { hr: 98 }, labs: { LAB_CRP: 3 } }] };
    store.save("admin-a", draft);
    expect(store.list("admin-a")).toEqual([draft]);
    expect(store.list("admin-b")).toEqual([]);
    const edited = { ...draft, name: "Updated" };
    store.save("admin-a", edited);
    expect(store.list("admin-a")).toEqual([edited]);
  });

  test("missing identity cannot overwrite another draft", () => {
    expect(() => store.save("admin-a", newBuilderDraft())).toThrow("BUILDER_DRAFT_IDENTITY_REQUIRED");
    expect(store.list("admin-a")).toEqual([]);
  });
});
