#!/usr/bin/env node
// Trusted operator only. The service credential and one-time token remain in
// this process's memory; neither is printed, placed in argv, or written to disk.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const projectRef = "fimcsrivizpliiuoqopv";
const endpoint = `https://${projectRef}.supabase.co/functions/v1/platform-admin-recovery`;
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const operation = args.get("--action")?.toUpperCase();
const targetUserId = args.get("--user-id") ?? "";
const targetEmail = args.get("--email")?.trim().toLowerCase() ?? "";
if (!(["GRANT", "REVOKE"].includes(operation)
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId)
  && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail))) {
  process.stderr.write("Usage: node scripts/platform-admin-recovery.mjs --action grant|revoke --user-id UUID --email EMAIL\n");
  process.exit(2);
}

let operatorKey;
try {
  operatorKey = execFileSync("security", ["find-generic-password", "-w",
    "-a", "russicaptor-supabase-service-role",
    "-s", `RussiCaptor-Supabase-ServiceRole-${projectRef}`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (!operatorKey) throw new Error("empty");
} catch {
  process.stderr.write("Trusted operator credential is unavailable; no recovery request was sent.\n");
  process.exit(3);
}

async function call(body) {
  const result = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${operatorKey}`,
      apikey: operatorKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    redirect: "error",
    cache: "no-store",
  });
  const parsed = await result.json().catch(() => ({}));
  if (!result.ok || parsed.ok !== true) throw new Error("TRUSTED_RECOVERY_REQUEST_FAILED");
  return parsed;
}

const operationId = randomUUID();
try {
  const prepared = await call({ action: "prepare", operationId, targetUserId, targetEmail, operation });
  if (!prepared.authorizationId || !prepared.token) throw new Error("TRUSTED_RECOVERY_PREPARE_INCOMPLETE");
  const applied = await call({ action: "apply", authorizationId: prepared.authorizationId,
    operationId, targetUserId, targetEmail, operation, token: prepared.token });
  if (applied.result?.targetUserId !== targetUserId || applied.result?.operation !== operation
    || !applied.result?.auditId) throw new Error("TRUSTED_RECOVERY_RESULT_UNVERIFIED");
  process.stdout.write(`${JSON.stringify({ operation, targetUserId, operationId,
    authorizationId: prepared.authorizationId, auditId: applied.result.auditId,
    status: applied.result.status })}\n`);
} catch {
  const state = await call({ action: "status", operationId }).catch(() => null);
  if (state?.result?.status === "CONSUMED" && state.result.auditId
    && state.result.targetUserId === targetUserId && state.result.operation === operation) {
    process.stdout.write(`${JSON.stringify({ operation, targetUserId, operationId,
      auditId: state.result.auditId, status: "CONFIRMED_AFTER_LOST_RESPONSE" })}\n`);
  } else {
    process.stderr.write("Recovery did not complete. Inspect bounded audit/status before retrying; no token is displayed.\n");
    process.exitCode = 1;
  }
} finally {
  operatorKey = "";
}
