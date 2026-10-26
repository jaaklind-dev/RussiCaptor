import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('../test/fixtures/writer-authorization/migration-baseline-v2.json', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = fs.readFileSync(fixture);
assert.equal(sha(bytes), '1e14a7dff431b08d963369df28fe0e12c698d56d14f307255b6e3cc0d31b7166', 'NATIVE_BASELINE_MANIFEST_CHANGED');
export const migrationBaseline = JSON.parse(bytes);
assert.equal(migrationBaseline.id, 'RC-CI-ACCEPTED-MIGRATION-BASELINE-V2');
assert.equal(migrationBaseline.entries.length, 56);
const expectedFiles = migrationBaseline.entries.map(e => e.file);
assert.deepEqual(expectedFiles, [...expectedFiles].sort());
assert.equal(new Set(expectedFiles.map(f => f.split('_')[0])).size, expectedFiles.length);

// Trust comes from the pinned accepted manifest, never from arbitrary source
// content. Validate ALL 56 inputs, even when a native stage stops at54 or55.
export function verifyMigrationInventory(sourceRoot) {
  const folder = path.join(sourceRoot, 'supabase/migrations');
  assert.equal(fs.lstatSync(folder).isSymbolicLink(), false, 'NATIVE_SOURCE_SYMLINK_FORBIDDEN');
  const files = fs.readdirSync(folder).sort();
  assert.equal(new Set(files.map(f => f.split('_')[0])).size, files.length, 'NATIVE_DUPLICATE_MIGRATION_ID');
  assert.deepEqual(files, expectedFiles, 'NATIVE_MIGRATION_INVENTORY_MISMATCH');
  const schema = path.join(sourceRoot, 'supabase/schema.sql');
  assert.equal(fs.lstatSync(schema).isSymbolicLink(), false, 'NATIVE_SOURCE_SYMLINK_FORBIDDEN');
  assert.equal(sha(fs.readFileSync(schema)), migrationBaseline.schemaSha256, 'NATIVE_SCHEMA_HASH_MISMATCH');
  return migrationBaseline.entries.map(entry => {
    assert.match(entry.file, /^\d+_[a-z0-9_]+\.sql$/);
    const file = path.join(folder, entry.file), stat = fs.lstatSync(file);
    assert.equal(stat.isSymbolicLink(), false, 'NATIVE_SOURCE_SYMLINK_FORBIDDEN');
    assert.equal(stat.isFile(), true, 'NATIVE_SOURCE_NOT_FILE');
    const content = fs.readFileSync(file);
    assert.equal(sha(content), entry.sha256, `NATIVE_CANDIDATE_HASH_MISMATCH:${entry.file}`);
    return { file: entry.file, hash: entry.sha256, bytes: content };
  });
}
