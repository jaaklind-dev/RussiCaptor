import { newBuilderDraft } from "../ExerciseBuilderService";
import { beginBuilderPickerReturn, clearBuilderPickerReturn, readBuilderPickerReturn,
  settleBuilderPickerReturn, shouldRestoreBuilderRoute } from "../BuilderPickerReturnService";

const values = new Map<string, string>();
const localStorageStub = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};
const draft = () => ({ ...newBuilderDraft(), packageId: "test.package", packageVersion: "1.0.0",
  patients: [{ id: "PT-001", name: "First", triage: "P1" as const, location: "ED", handover: "First",
    vitals: { hr: 96 }, labs: { LAB_CRP: 4 } },
  { id: "PT-002", name: "Second", triage: "P2" as const, location: "ED", handover: "Second",
    vitals: { hr: 112 }, labs: { LAB_CRP: 8 } }],
  studies: [{ id: "IMG-001", patientId: "PT-002", modality: "XR" as const,
    title: "Chest", report: "Report", resultDelaySeconds: 20 }] });
const begin = () => beginBuilderPickerReturn({ userId: "ADMIN-1", draft: draft(), section: "Pildiuuringud",
  patientId: "PT-002", studyId: "IMG-001", dirty: true });

describe("BUILDER-PICKER local return boundary", () => {
  beforeAll(() => { Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorageStub }); });
  beforeEach(() => values.clear());

  test("01 active draft identity and current editor context are checkpointed before picker", () => {
    const context = begin();
    expect(readBuilderPickerReturn("ADMIN-1")).toMatchObject({ operationId: context.operationId,
      section: "Pildiuuringud", patientId: "PT-002", studyId: "IMG-001", dirty: true,
      draft: { packageId: "test.package", packageVersion: "1.0.0" } });
  });
  test("02 and 16 only the authorized Admin root restores Builder", () => {
    const context = begin();
    expect(shouldRestoreBuilderRoute("admin", true, context)).toBe(true);
    expect(shouldRestoreBuilderRoute("admin/builder", true, context)).toBe(false);
    expect(shouldRestoreBuilderRoute("admin/users", true, context)).toBe(false);
  });
  test("03 and 04 unresolved authority keeps context without granting access", () => {
    const context = begin();
    expect(shouldRestoreBuilderRoute("admin", false, context)).toBe(false);
    expect(readBuilderPickerReturn("ADMIN-1")).toEqual(context);
  });
  test("05 definitive denial cannot restore Builder", () => {
    expect(shouldRestoreBuilderRoute("admin", false, begin())).toBe(false);
    expect(readBuilderPickerReturn("OTHER-USER")).toBeUndefined();
  });
  test("06–09 two patients, vitals, labs and imaging metadata survive recreation", () => {
    begin();
    const restored = readBuilderPickerReturn("ADMIN-1")!;
    expect(restored.draft.patients.map(item => item.name)).toEqual(["First", "Second"]);
    expect(restored.draft.patients[0].vitals.hr).toBe(96);
    expect(restored.draft.patients[1].labs.LAB_CRP).toBe(8);
    expect(restored.draft.studies[0]).toMatchObject({ patientId: "PT-002", title: "Chest", report: "Report" });
  });
  test.each(["png", "jpg"])("10–11 %s image settles once, retaining study and provenance fields", extension => {
    const context = begin();
    const image = { localUri: `file:///test/picture.${extension}`, fileName: `picture.${extension}`,
      source: "", licenseId: "", contributor: "" };
    const updated = { ...context.draft, studies: context.draft.studies.map(item => ({ ...item, image })) };
    expect(settleBuilderPickerReturn("ADMIN-1", context.operationId,
      { status: "IMPORTED", draft: updated })).toMatchObject({ status: "IMPORTED" });
    expect(settleBuilderPickerReturn("ADMIN-1", context.operationId,
      { status: "IMPORTED", draft: updated })).toBeUndefined();
    expect(readBuilderPickerReturn("ADMIN-1")?.draft.studies).toHaveLength(1);
  });
  test("12 cancel preserves draft and has no asset", () => {
    const context = begin();
    settleBuilderPickerReturn("ADMIN-1", context.operationId, { status: "CANCELLED", draft: context.draft });
    expect(readBuilderPickerReturn("ADMIN-1")?.draft).toEqual(context.draft);
    expect(readBuilderPickerReturn("ADMIN-1")?.draft.studies[0].image).toBeUndefined();
  });
  test("13 ingest failure preserves draft and Builder return context", () => {
    const context = begin();
    settleBuilderPickerReturn("ADMIN-1", context.operationId, { status: "ERROR", draft: context.draft,
      notice: "Import failed" });
    expect(readBuilderPickerReturn("ADMIN-1")?.draft).toEqual(context.draft);
    expect(shouldRestoreBuilderRoute("admin", true, readBuilderPickerReturn("ADMIN-1"))).toBe(true);
  });
  test("14 checkpoint is separate from the saved-draft list", () => {
    begin();
    expect([...values.keys()]).toEqual(["russicaptor.builder.picker-return.v1.ADMIN-1"]);
  });
  test("15 interrupted picker remains recoverable after screen/process recreation", () => {
    const context = begin();
    expect(readBuilderPickerReturn("ADMIN-1")?.status).toBe("PENDING");
    expect(readBuilderPickerReturn("ADMIN-1")?.operationId).toBe(context.operationId);
    clearBuilderPickerReturn("ADMIN-1");
    expect(readBuilderPickerReturn("ADMIN-1")).toBeUndefined();
  });
});
