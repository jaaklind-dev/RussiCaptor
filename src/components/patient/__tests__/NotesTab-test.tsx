import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import NotesTab from "../NotesTab";

describe("NotesTab duplicate-intent protection", () => {
  test("rapid presses submit the same draft only once after fast settlement", async () => {
    const onAddNote = jest.fn(async () => true);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<NotesTab notes={[]} onAddNote={onAddNote} />);
    });
    const input = renderer.root.findByType("TextInput" as never);
    await act(async () => input.props.onChangeText("technical acceptance note"));
    const save = renderer.root.findByProps({ accessibilityLabel: "Salvesta märge" });

    await act(async () => {
      save.props.onPress();
      await Promise.resolve();
      save.props.onPress();
      save.props.onPress();
    });

    expect(onAddNote).toHaveBeenCalledTimes(1);
    expect(onAddNote).toHaveBeenCalledWith("technical acceptance note");
  });
});
