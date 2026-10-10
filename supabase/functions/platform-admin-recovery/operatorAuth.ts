// Break-glass operator verification. The credential is never returned or logged.
// Auth Admin's user-list endpoint is read-only and unavailable to user/public keys.
export async function verifyRecoveryOperator(
  request: Request,
  supabaseUrl: string | undefined,
  probe: typeof fetch = fetch,
): Promise<boolean> {
  const authorization = request.headers.get("Authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match || !supabaseUrl) return false;
  const credential = match[1];
  const suppliedApiKey = request.headers.get("apikey");
  if (suppliedApiKey && suppliedApiKey !== credential) return false;

  let origin: URL;
  try {
    origin = new URL(supabaseUrl);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash) return false;
  } catch {
    return false;
  }

  try {
    const headers = new Headers({ apikey: credential });
    // Legacy service_role JWTs need bearer authentication at the Auth API.
    // Modern opaque keys are verified by the gateway through `apikey` alone.
    if (!credential.startsWith("sb_secret_")) headers.set("Authorization", `Bearer ${credential}`);
    const result = await probe(new URL("/auth/v1/admin/users?page=1&per_page=1", origin), {
      method: "GET",
      headers,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    await result.body?.cancel();
    return result.status === 200;
  } catch {
    return false;
  }
}
