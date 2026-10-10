import { verifyRecoveryOperator } from "../../../../supabase/functions/platform-admin-recovery/operatorAuth";

const server = "https://project.supabase.co";
const request = (credential?: string, apiKey = credential) => new Request("https://project.supabase.co/functions/v1/platform-admin-recovery", {
  method: "POST",
  headers: credential ? { Authorization: `Bearer ${credential}`, ...(apiKey ? { apikey: apiKey } : {}) } : {},
});

describe("PLATFORM_ADMIN recovery operator key compatibility", () => {
  const probe = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
  beforeEach(() => probe.mockReset());

  test.each([
    ["legacy service_role", "legacy.server.jwt", true],
    ["modern secret", "sb_secret_valid", false],
  ])("accepts verified %s credential", async (_label, credential, bearerForwarded) => {
    probe.mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await verifyRecoveryOperator(request(credential), server, probe)).toBe(true);
    const [url, options] = probe.mock.calls[0];
    expect(String(url)).toBe(`${server}/auth/v1/admin/users?page=1&per_page=1`);
    expect(options?.method).toBe("GET");
    expect((options?.headers as Headers).get("apikey")).toBe(credential);
    expect((options?.headers as Headers).has("Authorization")).toBe(bearerForwarded);
  });

  test.each([
    ["publishable", "sb_publishable_public"],
    ["anon", "anon.public.jwt"],
    ["user JWT, even platform admin", "ordinary.user.jwt"],
    ["arbitrary bearer", "arbitrary"],
  ])("rejects %s when Auth Admin denies capability", async (_label, credential) => {
    probe.mockResolvedValue(new Response(null, { status: 403 }));
    expect(await verifyRecoveryOperator(request(credential), server, probe)).toBe(false);
  });

  test("rejects missing, malformed, and mismatched bearer before probing", async () => {
    expect(await verifyRecoveryOperator(request(), server, probe)).toBe(false);
    expect(await verifyRecoveryOperator(new Request(server, { headers: { Authorization: "Bearer abc def" } }), server, probe)).toBe(false);
    expect(await verifyRecoveryOperator(request("sb_secret_one", "sb_secret_two"), server, probe)).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  test("fails closed on unsuccessful probe, timeout, or unsafe server URL", async () => {
    probe.mockResolvedValueOnce(new Response(null, { status: 401 })).mockRejectedValueOnce(new Error("network"));
    expect(await verifyRecoveryOperator(request("sb_secret_example"), server, probe)).toBe(false);
    expect(await verifyRecoveryOperator(request("sb_secret_example"), server, probe)).toBe(false);
    expect(await verifyRecoveryOperator(request("sb_secret_example"), "http://unsafe.example", probe)).toBe(false);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  test("never logs, returns, or audits the credential", async () => {
    const log = jest.spyOn(console, "log").mockImplementation();
    const error = jest.spyOn(console, "error").mockImplementation();
    probe.mockResolvedValue(new Response(null, { status: 403 }));
    expect(await verifyRecoveryOperator(request("sb_secret_private"), server, probe)).toBe(false);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });
});
