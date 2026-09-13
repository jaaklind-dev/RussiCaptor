import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const exerciseId = process.env.RUSSICAPTOR_CANONICAL_DERIVATION_EXERCISE_ID;
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!exerciseId || !supabaseUrl || !serviceRoleKey) {
  throw new Error("Trusted derivation requires exercise ID, Supabase URL and service-role key in the process environment.");
}

const collator = new Intl.Collator();
const arrayIndex = key => {
  if (!key.length) return undefined;
  const value = Number(key);
  return Number.isInteger(value) && value >= 0 && value <= 0xffff_fffe && String(value) === key ? value : undefined;
};
const compareKeys = (left, right) => {
  const leftIndex = arrayIndex(left); const rightIndex = arrayIndex(right);
  if (leftIndex !== undefined || rightIndex !== undefined) {
    if (leftIndex === undefined) return 1;
    if (rightIndex === undefined) return -1;
    return leftIndex - rightIndex;
  }
  return collator.compare(left, right);
};
const canonicalize = value => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort(compareKeys).map(key => [key, canonicalize(value[key])]));
};
const sha256 = value => createHash("sha256").update(value, "utf8").digest("hex");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: source, error: sourceError } = await supabase.from("runtime_checkpoints")
  .select("exercise_id,checkpoint_revision,persisted_runtime_version,payload_hash,provenance_hash,payload")
  .eq("exercise_id", exerciseId).maybeSingle();
if (sourceError || !source) throw new Error("Canonical derivation source checkpoint is unavailable.");

const canonicalPayloadText = JSON.stringify(canonicalize(source.payload.payload));
const computedHash = sha256(canonicalPayloadText);
if (computedHash !== source.payload_hash) throw new Error("Canonical derivation does not match the preserved source hash.");

const { error: installError } = await supabase.rpc("install_runtime_checkpoint_canonical_artifact", {
  p_exercise_id: source.exercise_id,
  p_checkpoint_revision: source.checkpoint_revision,
  p_payload_hash: source.payload_hash,
  p_provenance_hash: source.provenance_hash,
  p_persisted_runtime_version: source.persisted_runtime_version,
  p_canonical_format_version: 1,
  p_canonical_payload_text: canonicalPayloadText,
  p_derivation_method: "LEGACY_DERIVATION",
});
if (installError) throw new Error(`Canonical artifact installation failed: ${installError.code ?? "UNKNOWN"}`);

console.info("CANONICAL_LEGACY_ARTIFACT_INSTALLED", JSON.stringify({
  exerciseId: source.exercise_id,
  checkpointRevision: source.checkpoint_revision,
  payloadHash: source.payload_hash,
  provenanceHash: source.provenance_hash,
  canonicalCharacters: canonicalPayloadText.length,
  canonicalUtf8Bytes: Buffer.byteLength(canonicalPayloadText, "utf8"),
  derivationMethod: "LEGACY_DERIVATION",
}));
