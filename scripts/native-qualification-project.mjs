import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { migrationBaseline, verifyMigrationInventory } from './qualification-migration-baseline.mjs';

export const localConfig = 'project_id = "russicaptor-native-qualification"\n[db]\nmajor_version = 17\n';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function assertLocalConnection(config, socket, server) {
  assert.match(socket, /^\/private\/tmp\/russicaptor-pg176\.[A-Za-z0-9]+\/socket$/);
  assert.equal(config.host, socket, 'NATIVE_REMOTE_HOST_FORBIDDEN');
  assert.equal(config.database, 'russicaptor_m54_qual', 'NATIVE_DATABASE_MISMATCH');
  assert.equal(config.user, 'postgres');
  assert.ok([5432,5433].includes(config.port));
  assert.equal(config.password, undefined, 'NATIVE_CREDENTIAL_FORBIDDEN');
  assert.equal(config.connectionString, undefined, 'NATIVE_URL_FORBIDDEN');
  assert.equal(server.version_num, '170006', 'NATIVE_VERSION_MISMATCH');
  assert.equal(server.address, null, 'NATIVE_TCP_FORBIDDEN');
  assert.equal(server.database, config.database, 'NATIVE_DATABASE_MISMATCH');
}

// Deliberately do not inherit PG*, SUPABASE*, EXPO* or credentials. No .env,
// project-ref or production config is copied into either disposable project.
export function cliEnvironment(env) {
  return { PATH: env.PATH, LC_ALL: 'C', DO_NOT_TRACK: '1' };
}

export function stageQualificationProject(sourceRoot, clusterRoot, through) {
  assert.ok([54,55].includes(through));
  const directory = path.join(clusterRoot, `cli-source-through${through}`);
  assert.equal(fs.existsSync(directory), false, 'NATIVE_STAGE_ALREADY_EXISTS');
  const entries = verifyMigrationInventory(sourceRoot).slice(0,through);
  assert.equal(entries[53].file, migrationBaseline.entries[53].file);
  if (through===55) assert.equal(entries[54].file, migrationBaseline.entries[54].file);
  fs.mkdirSync(path.join(directory,'supabase/migrations'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory,'supabase/config.toml'), localConfig, { flag: 'wx', mode: 0o600 });
  for (const entry of entries) fs.writeFileSync(path.join(directory,'supabase/migrations',entry.file),entry.bytes,{ flag:'wx',mode:0o600 });
  const project = { directory, entries: entries.map(({ file,hash }) => ({ file,hash })) };
  validateQualificationProject(project);
  return project;
}

export function validateQualificationProject(project) {
  assert.ok([54,55].includes(project.entries.length), 'NATIVE_STAGE_LENGTH_MISMATCH');
  assert.deepEqual(project.entries, migrationBaseline.entries.slice(0,project.entries.length)
    .map(({file,sha256}) => ({file,hash:sha256})), 'NATIVE_STAGE_DESCRIPTOR_MISMATCH');
  const config = path.join(project.directory,'supabase/config.toml');
  assert.equal(fs.existsSync(config),true,'NATIVE_CONFIG_MISSING');
  assert.equal(fs.lstatSync(config).isSymbolicLink(),false,'NATIVE_CONFIG_SYMLINK_FORBIDDEN');
  assert.equal(fs.readFileSync(config,'utf8'),localConfig,'NATIVE_CONFIG_NOT_LOCAL');
  assert.equal(fs.existsSync(path.join(project.directory,'supabase/.temp/project-ref')),false,'NATIVE_LINK_FORBIDDEN');
  const folder=path.join(project.directory,'supabase/migrations');
  assert.deepEqual(fs.readdirSync(folder).sort(),project.entries.map(e=>e.file));
  for (const entry of project.entries) {
    const file=path.join(folder,entry.file);
    assert.equal(fs.lstatSync(file).isSymbolicLink(),false,'NATIVE_SOURCE_SYMLINK_FORBIDDEN');
    assert.equal(sha(fs.readFileSync(file)),entry.hash,'NATIVE_STAGED_HASH_MISMATCH');
  }
}
