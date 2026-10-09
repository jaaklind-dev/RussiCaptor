import React from "react";
import { Alert, Text, TextInput } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import ExerciseBuilderScreen from "@/app/admin/builder";
import type { OperatorSessionState } from "@/services/authorization/OperatorSessionService";
import { readBuilderPickerReturn } from "@/services/builder/BuilderPickerReturnService";

let mockSession: OperatorSessionState = { state: "UNAUTHENTICATED" };
jest.mock("@/hooks/useOperatorSession", () => ({ useOperatorSession: () => mockSession }));
jest.mock("expo-router", () => ({ router: { back: jest.fn() } }));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///test/", EncodingType: { Base64: "base64" },
  makeDirectoryAsync: jest.fn(async () => undefined), copyAsync: jest.fn(async () => undefined),
  StorageAccessFramework: {} }));

const values = new Map<string, string>();
const localStorageStub = { getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); } };

const session = (isPlatformAdmin: boolean): OperatorSessionState => ({
  state: "AUTHENTICATED", isPlatformAdmin, profile: { userId: "USER-1", displayName: "Test" },
  principal: { userId: "USER-1", roleAssignments: [] },
} as unknown as OperatorSessionState);
const text = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text)
  .flatMap(item => Array.isArray(item.props.children) ? item.props.children : [item.props.children])
  .filter(item => typeof item === "string").join(" ");

describe("Builder authorization", () => {
  beforeAll(() => { Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorageStub }); });
  beforeEach(() => { values.clear(); jest.clearAllMocks(); });
  test.each([["CM", false], ["EXCON", false], ["platform admin", true]] as const)(
    "%s access is fail-closed", async (_role, admin) => {
      mockSession = session(admin);
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => { renderer = TestRenderer.create(<ExerciseBuilderScreen />); });
      expect(text(renderer)).toContain(admin ? "Exercise Builder" : "ainult platvormi administraatorile");
      if (!admin) expect(text(renderer)).not.toContain("Paketi üldandmed");
    });
  test("unsaved authoring is not silently discarded when starting another package", async () => {
    mockSession = session(true);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<ExerciseBuilderScreen />); });
    const name = renderer.root.findAllByType(TextInput).find(item => item.props.accessibilityLabel === "Paketi nimi")!;
    await act(async () => { name.props.onChangeText("Uus õppus"); });
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const start = renderer.root.findAll(item =>
      item.props.accessibilityLabel === "Alusta uut paketti");
    await act(async () => { start[0].props.onPress(); });
    expect(alert).toHaveBeenCalledWith("Salvestamata muudatused", expect.any(String), expect.any(Array));
    expect(renderer.root.findAllByType(TextInput).find(item => item.props.accessibilityLabel === "Paketi nimi")?.props.value)
      .toBe("Uus õppus");
    alert.mockRestore();
  });

  test.each(["png", "jpg"])("BUILDER-PICKER %s selection returns to same unsaved draft once", async extension => {
    mockSession = session(true);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<ExerciseBuilderScreen />); });
    const press = async (label: string) => { await act(async () => { renderer.root.findAll(item =>
      item.props.accessibilityLabel === label || (item.props.accessibilityRole === "tab" &&
        item.findAllByType(Text).some(child => child.props.children === label)))[0].props.onPress(); }); };
    const edit = async (label: string, value: string) => { await act(async () => {
      renderer.root.findAllByType(TextInput).find(item => item.props.accessibilityLabel === label)!
        .props.onChangeText(value);
    }); };
    await edit("Paketi nimi", "Unsaved exercise");
    await press("Patsiendid"); await press("Lisa patsient");
    await edit("Patsiendi nimi", "Patient One");
    await press("Lisa patsient"); await edit("Patsiendi nimi", "Patient Two");
    await press("Pildiuuringud"); await press("Lisa uuring");
    await edit("Uuringu nimetus", "Chest image");
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false,
      assets: [{ uri: `file:///cache/image.${extension}`, name: `image.${extension}`,
        mimeType: `image/${extension}`, lastModified: Date.now() }] });
    await press("Vali JPEG/PNG pilt");
    expect(jest.mocked(DocumentPicker.getDocumentAsync)).toHaveBeenCalledTimes(1);
    expect(jest.mocked(FileSystem.copyAsync)).toHaveBeenCalledTimes(1);
    const restored = readBuilderPickerReturn("USER-1")!;
    expect(restored.status).toBe("IMPORTED");
    expect(restored.draft.patients.map(item => item.name)).toEqual(["Patient One", "Patient Two"]);
    expect(restored.draft.studies[0]).toMatchObject({ title: "Chest image", image: { fileName: `image.${extension}` } });
    expect(renderer.root.findAllByType(TextInput).find(item => item.props.accessibilityLabel === "Pildi allikas"))
      .toBeDefined();
  });

  test("BUILDER-PICKER cancel retains unsaved Builder content", async () => {
    mockSession = session(true);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<ExerciseBuilderScreen />); });
    const press = async (label: string) => { await act(async () => { renderer.root.findAll(item =>
      item.props.accessibilityLabel === label || (item.props.accessibilityRole === "tab" &&
        item.findAllByType(Text).some(child => child.props.children === label)))[0].props.onPress(); }); };
    await press("Pildiuuringud"); await press("Lisa uuring");
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: true, assets: null });
    await press("Vali JPEG/PNG pilt");
    expect(readBuilderPickerReturn("USER-1")?.status).toBe("CANCELLED");
    expect(readBuilderPickerReturn("USER-1")?.draft.studies).toHaveLength(1);
    expect(jest.mocked(FileSystem.copyAsync)).not.toHaveBeenCalled();
  });

  test("BUILDER-AUTHREADY-08/09 confirmed refresh preserves the active draft and clinical authoring fields", async () => {
    mockSession = session(true);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<ExerciseBuilderScreen />); });
    const edit = async (label: string, value: string) => { await act(async () => {
      renderer.root.findAllByType(TextInput).find(item => item.props.accessibilityLabel === label)!
        .props.onChangeText(value);
    }); };
    const press = async (label: string) => { await act(async () => { renderer.root.findAll(item =>
      item.props.accessibilityLabel === label || (item.props.accessibilityRole === "tab" &&
        item.findAllByType(Text).some(child => child.props.children === label)))[0].props.onPress(); }); };
    await edit("Paketi nimi", "Still editing");
    await edit("Paketi ID", "test.builder");
    await press("Patsiendid"); await press("Lisa patsient");
    await edit("Patsiendi nimi", "Patient One");
    await press("Näitajad"); await edit("Pulss (lööki/min)", "91");
    await press("Labor");
    const lab = renderer.root.findAllByType(TextInput).find(item => item.props.accessibilityLabel?.includes("CRP"));
    if (lab) await edit(lab.props.accessibilityLabel, "3");
    await press("Pildiuuringud"); await press("Lisa uuring"); await edit("Uuringu nimetus", "XR test");
    mockSession = { ...session(true), authorityRefresh: "REFRESHING" } as OperatorSessionState;
    await act(async () => { renderer.update(<ExerciseBuilderScreen />); });
    expect(text(renderer)).toContain("Exercise Builder");
    expect(text(renderer)).toContain("Uuendan õiguste kinnitust");
    mockSession = { ...session(true), authorityRefresh: "TRANSIENT_ERROR" } as OperatorSessionState;
    await act(async () => { renderer.update(<ExerciseBuilderScreen />); });
    expect(text(renderer)).toContain("Viimane kinnitatud õigus kehtib selles seansis");
    await press("Üldandmed");
    expect(renderer.root.findAllByType(TextInput).find(item => item.props.accessibilityLabel === "Paketi nimi")?.props.value)
      .toBe("Still editing");
    expect(renderer.root.findAllByType(TextInput).find(item => item.props.accessibilityLabel === "Paketi ID")?.props.value)
      .toBe("test.builder");
    await press("Patsiendid");
    expect(text(renderer)).toContain("Patient One");
    await press("Näitajad");
    expect(renderer.root.findAllByType(TextInput).find(item => item.props.accessibilityLabel === "Pulss (lööki/min)")?.props.value)
      .toBe("91");
    await press("Pildiuuringud");
    expect(renderer.root.findAllByType(TextInput).find(item => item.props.accessibilityLabel === "Uuringu nimetus")?.props.value)
      .toBe("XR test");
  });

  test("BUILDER-AUTHREADY-12 no confirmed authority shows bounded retry instead of perpetual checking", async () => {
    mockSession = { state: "UNAVAILABLE", message: "retry" };
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<ExerciseBuilderScreen />); });
    expect(text(renderer)).toContain("Administraatori õigusi ei saanud kontrollida");
    expect(renderer.root.findAll(item => item.props.accessibilityLabel === "Proovi õiguste kontrolli uuesti").length)
      .toBeGreaterThan(0);
    expect(text(renderer)).not.toContain("Paketi üldandmed");
  });
});
