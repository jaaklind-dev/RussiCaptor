import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";

import { ExconRouteReadinessBoundary } from "../ExconRouteReadinessBoundary";

describe("EXCON route readiness boundary", () => {
  test("pending readiness renders a bounded loading shell and no EXCON actions", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ExconRouteReadinessBoundary readiness={{
          state: "PENDING",
          reason: "CURRENT_EXERCISE",
          intendedExerciseId: "EX-LEGACY",
        }}>
          <Text testID="excon-action">EXCON action</Text>
        </ExconRouteReadinessBoundary>,
      );
    });
    const output = JSON.stringify(renderer.toJSON());
    expect(output).toContain("excon-route-readiness-pending");
    expect(output).not.toContain("excon-action");
    expect(output).not.toContain("EX-LEGACY");
  });

  test("authorized readiness renders workbench content", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <ExconRouteReadinessBoundary readiness={{
          state: "AUTHORIZED",
          exerciseId: "EX-LEGACY",
          intendedExerciseId: "EX-LEGACY",
        }}>
          <Text testID="excon-action">EXCON action</Text>
        </ExconRouteReadinessBoundary>,
      );
    });
    expect(JSON.stringify(renderer.toJSON())).toContain("excon-action");
  });
});
