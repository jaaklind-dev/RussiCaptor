import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { runCases } from './test-writer-authorization.mjs';
import { qualifyHistoricalPrivileges } from './qualify-writer-historical-privileges.mjs';

// No URL or TCP connection is accepted. Only the private socket of a disposable
// cluster created for this qualification may be used; no production credentials.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const socket = fs.realpathSync(process.env.WRITER_AUTH_NATIVE_SOCKET || '/missing-native-socket');
assert.match(socket, /^\/private\/tmp\/russicaptor-pg176\.[A-Za-z0-9]+\/socket$/);
assert.equal(fs.statSync(socket).uid, process.getuid());
assert.equal(fs.statSync(socket).mode & 0o077, 0);
const require = createRequire(import.meta.url);
const { Client } = require(process.env.WRITER_AUTH_PG_MODULE || 'pg');
const config = { host: socket, port: 5432, database: 'russicaptor_m54_qual', user: 'postgres',
  connectionTimeoutMillis: 5000, application_name: 'russicaptor-m54-native-qualification' };
const client = new Client(config);
const results = [];
const query = (sql, args) => client.query(sql, args);
const db = { exec: sql => query(sql) };
const pass = async (name, action) => { await action(); results.push({ name, status: 'PASS' }); };
const deny = (name, action, expected) => pass(name, () => assert.rejects(action, e => expected.test(e.message)));
const candidate = '20261019171013_runtime_writer_controller_authorization.sql';
const sql = fs.readFileSync(path.join(root, 'supabase/migrations', candidate), 'utf8');
const migrationHash = createHash('sha256').update(sql).digest('hex');
const cli = process.env.WRITER_AUTH_SUPABASE_CLI;
assert.ok(cli && path.isAbsolute(cli), 'explicit reviewed Supabase CLI required');
const execute = promisify(execFile);
const migrate = async () => {
  const url = new URL(`postgresql://${encodeURIComponent(config.user)}@localhost:5432/${config.database}`);
  url.searchParams.set('host', socket);
  const result = await execute(cli, ['db', 'push', '--db-url', url.href, '--skip-vault', '--yes', '--workdir', root],
    { env: { ...process.env, DO_NOT_TRACK: '1' }, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  console.log(JSON.stringify({ migrationMechanism: 'supabase db push --db-url <private UNIX socket> --skip-vault', ...result }));
};
try {
  await client.connect();
  const version = (await query("select version(),current_setting('server_version_num') version_num,inet_server_addr() address,current_database() database")).rows[0];
  console.log(JSON.stringify({ version, migrationHash, cli }));
  assert.equal(version.version_num, '170006');
  assert.equal(version.address, null);
  assert.equal((await query("select count(*)::int n from information_schema.tables where table_schema='public'")).rows[0].n, 0,
    'qualification requires a fresh disposable database; never reuse application data');
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key,email text,is_anonymous boolean not null default false,banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
    create function auth.role() returns text language sql stable as $$select current_setting('role',true)$$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on all functions in schema auth to anon,authenticated,service_role;
    create publication supabase_realtime;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text);
  `);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
  const files = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
  assert.equal(files.length, 54);
  assert.equal(files.at(-1), candidate);
  // Reconstruct 1-53, including their ledger, BEFORE creating upgrade fixtures.
  for (const file of files.slice(0, -1)) {
    await query('begin');
    try {
      const text = fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8');
      await db.exec(text);
      await query('insert into supabase_migrations.schema_migrations values($1,$2,$3)',
        [file.split('_')[0], [text], file.replace(/^\d+_|\.sql$/g, '')]);
      await query('commit');
    } catch (error) { await query('rollback'); throw error; }
  }
  await db.exec(fs.readFileSync(path.join(root, 'supabase/tests/runtime_writer_authorization_test.sql'), 'utf8'));
  const cm = '10000000-0000-0000-0000-000000000001';
  const excon = '10000000-0000-0000-0000-000000000002';
  const identities = [cm, excon, '10000000-0000-0000-0000-000000000003'];
  const identity = async user => query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    [user, JSON.stringify({ sub: user, role: 'authenticated', is_anonymous: false })]);
  const expireFixtureLease = async id => {
    const original = (await query('select * from public.runtime_writer_leases where exercise_id=$1', [id])).rows[0];
    assert.ok(original);
    // One database reference instant, no sleeps or independently sampled dates.
    const reference = (await query('select clock_timestamp() as reference')).rows[0].reference;
    const expired = (await query(`update public.runtime_writer_leases
      set acquired_at=$2::timestamptz-interval '2 minutes',
          refreshed_at=$2::timestamptz-interval '90 seconds',
          expires_at=$2::timestamptz-interval '1 minute'
      where exercise_id=$1 returning *,
        acquired_at<refreshed_at and refreshed_at<expires_at as valid_interval,
        expires_at<$2::timestamptz and expires_at<clock_timestamp() as genuinely_expired`, [id, reference])).rows[0];
    assert.equal(expired.valid_interval, true);
    assert.equal(expired.genuinely_expired, true);
    for (const key of ['exercise_id', 'lease_id', 'writer_instance_id', 'writer_user_id', 'writer_generation', 'released_at']) {
      assert.deepEqual(expired[key], original[key], `expiry fixture changed ${key}`);
    }
    console.log(JSON.stringify({ fixture: 'EXPIRED_LEASE', exercise: id, reference,
      acquiredAt: expired.acquired_at, refreshedAt: expired.refreshed_at, expiresAt: expired.expires_at,
      validInterval: expired.valid_interval, genuinelyExpired: expired.genuinely_expired,
      identityAndGenerationUnchanged: true }));
  };
  const fixtures = [];
  for (const kind of ['NO_WRITER', 'EXCON', 'CM', 'EXPIRED', 'PENDING']) {
    const id = `EX-NATIVE-UPGRADE-${kind}`;
    for (const user of identities) await query(`insert into public.authorization_role_assignments
      (user_id,role,scope_type,scope_id,status,issued_by) values($1,$2,'EXERCISE',$3,'ACTIVE',$1)`,
    [user, user === cm ? 'CM' : 'EXCON', id]);
    await identity(excon);
    const state = { exerciseSession: { exerciseId: id, lifecycleState: 'RUNNING', simulationTimeSec: 12, speed: 1, version: 1 },
      exercisePackageReference: { packageId: 'writer-auth-synthetic', packageVersion: '1.0.0' },
      patientMaterialization: { packageHash: 'synthetic' }, patients: [{ id: 'PT-001', name: 'Synthetic' }], runtimePatientCommandCursor: 0 };
    await query('insert into public.exercise_states(exercise_id,revision,state,updated_by) values($1,1,$2,$3)', [id, state, excon]);
    if (kind !== 'NO_WRITER') {
      await identity(kind === 'CM' ? cm : excon);
      await query('set role authenticated');
      let lease;
      try { lease = (await query("select * from public.acquire_runtime_writer($1,'upgrade-writer',0,300)", [id])).rows[0]; }
      finally { await query('reset role'); }
      const text = JSON.stringify(state);
      await query('set role authenticated');
      try { await query("select * from public.publish_runtime_checkpoint_canonical_payload($1,'upgrade-writer',0,$2,1,1,$3,$4,1,$5)",
        [lease.lease_id, id, createHash('sha256').update(text).digest('hex'), createHash('sha256').update('synthetic-provenance').digest('hex'), text]); }
      finally { await query('reset role'); }
      if (kind === 'CM') {
        await query('set role authenticated');
        try { await query("select * from public.renew_runtime_writer($1,'upgrade-writer',300)", [lease.lease_id]); }
        finally { await query('reset role'); }
      }
      if (kind === 'EXPIRED') await expireFixtureLease(id);
      if (kind === 'PENDING') {
        await query('set role authenticated');
        try { await query("select * from public.submit_runtime_completion_request($1,'NATIVE-ORIGINAL-COMPLETION',1)", [id]); }
        finally { await query('reset role'); }
      }
      fixtures.push({ id, kind, lease });
    } else fixtures.push({ id, kind });
  }
  const snapshot = async () => (await query(`select jsonb_build_object(
    'leases',(select jsonb_agg(to_jsonb(t) order by exercise_id) from public.runtime_writer_leases t),
    'checkpoints',(select jsonb_agg(to_jsonb(t) order by exercise_id) from public.runtime_checkpoints t),
    'artifacts',(select jsonb_agg(to_jsonb(t) order by exercise_id) from public.runtime_checkpoint_canonical_artifacts t),
    'completions',(select jsonb_agg(to_jsonb(t) order by exercise_id) from public.runtime_completion_requests t),
    'states',(select jsonb_agg(to_jsonb(t) order by exercise_id) from public.exercise_states t)) value`)).rows[0].value;
  const before = await snapshot();
  const oldDefinitions = (await query("select proname,pg_get_functiondef(oid) definition from pg_proc where oid in ('public.enforce_runtime_operator_scope()'::regprocedure,'public.record_runtime_patient_command_result(text,bigint,uuid,text,text,jsonb)'::regprocedure) order by proname")).rows;
  await migrate();
  if (process.env.WRITER_AUTH_NATIVE_PRIVILEGES === '1') {
    await qualifyHistoricalPrivileges({ query, setCmIdentity: () => identity(cm) });
  }
  await pass('real CLI 53-to-54 upgrade preserves all existing records and generations', async () => {
    assert.equal((await query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n, 54);
    assert.deepEqual(await snapshot(), before);
    const definitions = (await query("select proname,pg_get_functiondef(oid) definition from pg_proc where oid in ('public.enforce_runtime_operator_scope()'::regprocedure,'public.record_runtime_patient_command_result(text,bigint,uuid,text,text,jsonb)'::regprocedure) order by proname")).rows;
    assert.equal(definitions.length, 2);
    for (let i = 0; i < 2; i++) assert.notEqual(definitions[i].definition, oldDefinitions[i].definition);
  });
  const legacy = fixtures.find(f => f.kind === 'CM');
  await identity(cm);
  await query('set role authenticated');
  try {
    await deny('genuine pre-migration CM lease cannot heartbeat', () => query("select * from public.renew_runtime_writer($1,'upgrade-writer',60)", [legacy.lease.lease_id]), /AUTHORIZATION_DENIED/);
  } finally { await query('reset role'); }
  assert.deepEqual(await snapshot(), before);
  const pending = fixtures.find(f => f.kind === 'PENDING');
  await identity(excon);
  await query('set role authenticated');
  try {
    await pass('pre-upgrade PENDING request retry retains its operation', async () => {
      const retry = await query("select * from public.submit_runtime_completion_request($1,'NATIVE-ORIGINAL-COMPLETION',1)", [pending.id]);
      assert.equal(retry.rows[0].status, 'PENDING');
    });
  } finally { await query('reset role'); }
  await expireFixtureLease(pending.id);
  await identity(identities[2]);
  await query('set role authenticated');
  let recovered;
  try { recovered = (await query("select * from public.acquire_runtime_writer($1,'recovered-writer',1,300)", [pending.id])).rows[0]; }
  finally { await query('reset role'); }
  const terminal = { ...before.states.find(s => s.exercise_id === pending.id).state };
  terminal.exerciseSession = { ...terminal.exerciseSession, lifecycleState: 'COMPLETED' };
  const terminalText = JSON.stringify(terminal);
  const terminalArgs = [pending.id, 'NATIVE-ORIGINAL-COMPLETION', recovered.lease_id, 'recovered-writer', 1, 2,
    createHash('sha256').update(terminalText).digest('hex'), createHash('sha256').update('synthetic-provenance').digest('hex'), terminalText];
  const terminalSql = 'select * from public.finalize_runtime_completion_canonical_payload($1,$2,$3,$4,$5,$6,1,$7,$8,1,$9)';
  await query('set role authenticated');
  try {
    await deny('pre-upgrade PENDING old generation rejected', () => query(terminalSql,
      [pending.id, terminalArgs[1], pending.lease.lease_id, 'upgrade-writer', ...terminalArgs.slice(4)]), /STALE_WRITER/);
    await pass('pre-upgrade PENDING EXCON recovery commits exactly once after lost acknowledgment', async () => {
      await query(terminalSql, terminalArgs);
      const first = await snapshot();
      await query(terminalSql, terminalArgs);
      assert.deepEqual(await snapshot(), first);
      const request = first.completions.find(r => r.exercise_id === pending.id);
      assert.equal(request.command_id, 'NATIVE-ORIGINAL-COMPLETION');
      assert.equal(request.status, 'COMPLETED');
      assert.equal(request.terminal_checkpoint_revision, 2);
      assert.ok(first.leases.find(l => l.exercise_id === pending.id).released_at);
    });
  } finally { await query('reset role'); }
  await runCases({ db, query, pass, deny, fixtureReady: true });
  console.log(JSON.stringify({ migrationHash, fixtures: fixtures.map(f => ({ id: f.id, kind: f.kind })), results, passed: results.length }));
} catch (error) {
  console.error(JSON.stringify({ results, failure: error.message, code: error.code }));
  process.exitCode = 1;
} finally { await client.end(); }
