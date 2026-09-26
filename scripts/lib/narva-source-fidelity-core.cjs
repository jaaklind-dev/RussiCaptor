const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const stable = value => JSON.stringify(canonical(value));
const equal = (left, right) => stable(left) === stable(right);

const evaluateFidelity = (manifest, actualById) => manifest.items.map(item => {
  const actual = actualById[item.id];
  const drift = actual === undefined ? "MISSING_ACTUAL" : equal(actual, item.productionValue) ? null : "PRODUCTION_DRIFT";
  return Object.freeze({ ...item, actualProductionValue: actual, drift });
});

const summarizeFidelity = results => {
  const counts = Object.fromEntries([
    "MATCH", "ACCEPTED_DERIVATION", "INTENTIONAL_IMPLEMENTATION_POLICY", "SOURCE_DEFINED_MISSING",
    "SOURCE_AMBIGUOUS", "SOURCE_CONFLICT", "NOT_APPLICABLE",
  ].map(value => [value, 0]));
  for (const result of results) counts[result.classification] += 1;
  return Object.freeze({ total: results.length, counts: Object.freeze(counts),
    drift: Object.freeze(results.filter(item => item.drift)),
    nonMatch: Object.freeze(results.filter(item => item.classification !== "MATCH")) });
};

const sha256File = path => createHash("sha256").update(readFileSync(path)).digest("hex");

module.exports = { evaluateFidelity, summarizeFidelity, sha256File };
