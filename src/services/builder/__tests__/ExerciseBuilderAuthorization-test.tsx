import React from "react";
import { Alert, Text, TextInput } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import ExerciseBuilderScreen from "@/app/admin/builder";
import type { OperatorSessionState } from "@/services/authorization/OperatorSessionService";

let mockSession: OperatorSessionState = { state: "UNAUTHENTICATED" };
jest.mock("@/hooks/useOperatorSession", () => ({ useOperatorSession: () => mockSession }));
jest.mock("expo-router", () => ({ router: { back: jest.fn() } }));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///test/", EncodingType: { Base64: "base64" },
  StorageAccessFramework: {} }));

const session = (isPlatformAdmin: boolean): OperatorSessionState => ({
  state: "AUTHENTICATED", isPlatformAdmin, profile: { userId: "USER-1", displayName: "Test" },
  principal: { userId: "USER-1", roleAssignments: [] },
} as unknown as OperatorSessionState);
const text = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text)
  .flatMap(item => Array.isArray(item.props.children) ? item.props.children : [item.props.children])
  .filter(item => typeof item === "string").join(" ");

describe("Builder authorization", () => {
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
});
