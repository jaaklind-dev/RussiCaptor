const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const stable = value => JSON.stringify(canonical(value));
const equal = (left, right) => stable(left) === stable(right);
const authoritySourceTypes = new Set(["ORIGINAL_SOURCE", "CORRECTED_SOURCE", "USER_DECISION",
  "ACCEPTED_WORK_PACKAGE", "IMPLEMENTATION_POLICY"]);
const authorityStatuses = new Set(["CURRENT", "SUPERSEDED", "HISTORICAL"]);

const resolveCurrentAuthority = item => {
  if (!item.authorityChain) return Object.freeze({ value: item.productionValue, authority: null, errors: [] });
  const records = item.authorityChain;
  const errors = [];
  const ids = records.map(record => record.authorityId);
  if (new Set(ids).size !== ids.length) errors.push("DUPLICATE_AUTHORITY_ID");
  const current = records.find(record => record.authorityId === item.currentAuthorityId);
  if (!current) errors.push("CURRENT_AUTHORITY_NOT_FOUND");
  if (current && current.status !== "CURRENT") errors.push("CURRENT_AUTHORITY_STATUS_INVALID");
  if (records.filter(record => record.status === "CURRENT").length !== 1) errors.push("CURRENT_AUTHORITY_COUNT_INVALID");
  for (const record of records) {
    if (!authoritySourceTypes.has(record.sourceType)) errors.push(`UNKNOWN_AUTHORITY_SOURCE_TYPE:${record.sourceType}`);
    if (!authorityStatuses.has(record.status)) errors.push(`UNKNOWN_AUTHORITY_STATUS:${record.status}`);
    for (const supersededId of record.supersedesAuthorityIds ?? []) {
      if (!ids.includes(supersededId)) errors.push(`UNKNOWN_SUPERSEDED_AUTHORITY:${supersededId}`);
    }
  }
  const superseded = records.filter(record => record.status === "SUPERSEDED");
  for (const record of superseded) {
    if (!(current?.supersedesAuthorityIds ?? []).includes(record.authorityId)) {
      errors.push(`SUPERSESSION_NOT_EXPLICIT:${record.authorityId}`);
    }
  }
  return Object.freeze({ value: current?.semanticValue, authority: current ?? null, errors: Object.freeze(errors) });
};

const evaluateFidelity = (manifest, actualById) => manifest.items.map(item => {
  const actual = actualById[item.id];
  const authority = resolveCurrentAuthority(item);
  const drift = authority.errors.length > 0 ? "AUTHORITY_CHAIN_INVALID"
    : actual === undefined ? "MISSING_ACTUAL" : equal(actual, authority.value) ? null : "PRODUCTION_DRIFT";
  return Object.freeze({ ...item, expectedProductionValue: authority.value,
    resolvedCurrentAuthority: authority.authority, authorityErrors: authority.errors,
    actualProductionValue: actual, drift });
});

const summarizeFidelity = results => {
  const counts = Object.fromEntries([
    "MATCH", "ACCEPTED_DERIVATION", "INTENTIONAL_IMPLEMENTATION_POLICY", "SOURCE_DEFINED_MISSING",
    "SOURCE_AMBIGUOUS", "SOURCE_CONFLICT", "SUPERSEDED_SOURCE_VALUE", "NOT_APPLICABLE",
  ].map(value => [value, 0]));
  for (const result of results) counts[result.classification] += 1;
  return Object.freeze({ total: results.length, counts: Object.freeze(counts),
    drift: Object.freeze(results.filter(item => item.drift)),
    nonMatch: Object.freeze(results.filter(item => item.classification !== "MATCH")) });
};

const sha256File = path => createHash("sha256").update(readFileSync(path)).digest("hex");

module.exports = { evaluateFidelity, resolveCurrentAuthority, summarizeFidelity, sha256File };
