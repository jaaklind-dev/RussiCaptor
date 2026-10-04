import React from "react";
import TestRenderer, { act } from "react-test-renderer";

import AuthCallbackCoordinator from "../AuthCallbackCoordinator";

const mockReplace = jest.fn();
const mockConsume = jest.fn();
const mockGetInitialURL = jest.fn();
let mockUrlListener: ((event: { url: string }) => void) | undefined;

jest.mock("expo-router", () => ({ router: { replace: (...args: unknown[]) => mockReplace(...args) } }));
jest.mock("expo-linking", () => ({
  getInitialURL: () => mockGetInitialURL(),
  addEventListener: (_type: string, listener: (event: { url: string }) => void) => {
    mockUrlListener = listener;
    return { remove: jest.fn() };
  },
}));
jest.mock("@/services/auth/AuthCallbackService", () => ({
  isAuthCallbackUrl: (value: string) => value.startsWith("russicaptor://auth/callback"),
  consumeAuthCallbackUrl: (value: string) => mockConsume(value),
}));

describe("Auth callback routing", () => {
  beforeEach(() => { mockReplace.mockReset(); mockConsume.mockReset(); mockGetInitialURL.mockReset(); mockUrlListener = undefined; });

  test("AUTH-CB-02/04: cold-start invite callback opens password setup", async () => {
    mockGetInitialURL.mockResolvedValue("russicaptor://auth/callback#opaque");
    mockConsume.mockResolvedValue({ ok: true, flow: "invite" });
    await act(async () => { TestRenderer.create(<AuthCallbackCoordinator />); });
    expect(mockConsume).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/auth/set-password", params: { flow: "invite" } });
  });

  test("AUTH-CB-03/05: already-running recovery callback opens password setup", async () => {
    mockGetInitialURL.mockResolvedValue(null);
    mockConsume.mockResolvedValue({ ok: true, flow: "recovery" });
    await act(async () => { TestRenderer.create(<AuthCallbackCoordinator />); });
    await act(async () => { mockUrlListener?.({ url: "russicaptor://auth/callback#opaque" }); });
    expect(mockConsume).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/auth/set-password", params: { flow: "recovery" } });
  });

  test("AUTH-CB-08: callback failure exposes only bounded status", async () => {
    mockGetInitialURL.mockResolvedValue("russicaptor://auth/callback#error=secret-shaped");
    mockConsume.mockResolvedValue({ ok: false, reason: "EXPIRED_OR_INVALID" });
    await act(async () => { TestRenderer.create(<AuthCallbackCoordinator />); });
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/auth/callback", params: { status: "EXPIRED_OR_INVALID" } });
  });
});
