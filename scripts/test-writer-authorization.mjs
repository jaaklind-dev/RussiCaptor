import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { privilegeSnapshot, assertPrivilegeOnlyChange, qualifyRuntimeTablePrivileges } from './qualify-runtime-table-privileges.mjs';
import { verifyMigrationInventory } from './qualification-migration-baseline.mjs';
import { installCIHistoricalBaseline, registerCIFixtureIdentity } from './ci-historical-protection-baseline.mjs';
import { qualifyCIHistoricalProtection } from './test-ci-historical-protection.mjs';

// Only an in-memory PostgreSQL instance is constructed. No connection string,
// Supabase client, remote endpoint, or production identity is accepted.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const require = createRequire(import.meta.url);
const modulePath = process.env.WRITER_AUTH_PGLITE_MODULE || '@electric-sql/pglite';
const { PGlite } = require(modulePath);
const { pgcrypto } = require(path.join(path.dirname(require.resolve(modulePath)), 'contrib/pgcrypto.cjs'));
const db = new PGlite({ extensions: { pgcrypto } });
const results = [];
const query = (sql, params = []) => db.query(sql, params);

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create table auth.users (id uuid primary key, email text,
      is_anonymous boolean not null default false, banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    create function auth.role() returns text language sql stable as
      $$ select current_setting('role', true) $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create publication supabase_realtime;
    -- Supabase default API grants are platform setup, not application migrations.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
  const entries = verifyMigrationInventory(root);
  const migrations = entries.map(entry => entry.file);
  const catalog = async () => ({
    functions: (await query(`select p.proname,pg_get_function_identity_arguments(p.oid) as args,
      pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind='f' order by p.proname,args`)).rows,
    policies: (await query("select * from pg_policies where schemaname='public' order by tablename,policyname")).rows,
    triggers: (await query(`select c.relname,t.tgname,pg_get_triggerdef(t.oid) as definition,t.tgenabled
      from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal order by c.relname,t.tgname`)).rows,
  });
  for (const file of migrations) {
    if (file === migrations[53]) {
      await installCIHistoricalBaseline(db);
      results.push({name:'exact accepted historical-protection prerequisites installed before54',status:'PASS'});
    }
    const correction = file.endsWith('_runtime_writer_controller_authorization.sql');
    const privileges = file.endsWith('_runtime_critical_table_privileges.sql');
    const beforePrivileges = privileges ? await privilegeSnapshot(query) : undefined;
    const before = correction ? await catalog() : undefined;
    try { await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8')); }
    catch (error) { throw new Error(`LOCAL_MIGRATION_FAILED:${file}:${error.message}`, { cause: error }); }
    if (beforePrivileges) {
      assertPrivilegeOnlyChange(beforePrivileges, await privilegeSnapshot(query));
      results.push({ name: 'migration55 changes only the twelve excess table grants', status: 'PASS' });
    }
    if (before) {
      const after = await catalog();
      assert.deepEqual(after.policies, before.policies);
      assert.deepEqual(after.triggers, before.triggers);
      const changed = after.functions.filter((f, i) => f.definition !== before.functions[i]?.definition).map(f => f.proname);
      assert.deepEqual(changed, ['enforce_runtime_operator_scope', 'record_runtime_patient_command_result']);
      results.push({ name: 'migration changes exactly two functions; RLS and triggers unchanged', status: 'PASS' });
    }
  }
  console.log(JSON.stringify({ postgres: (await query('select version()')).rows[0], migrations: migrations.length,
    isolation: 'fresh in-memory database; synthetic users only; actual complete migration chain' }));
  // Cases are registered below; the runner deliberately never skips an absent
  // dependency or a failed migration. Every rejection must be a real SQL error.
  const pass = async (name, action) => { await action(); results.push({ name, status: 'PASS' }); };
  const deny = async (name, action, expected) => pass(name, async () => {
    await assert.rejects(action, error => expected.test(error.message));
  });
  await runCases({ db, query, pass, deny, registerFixtureIdentity: id => registerCIFixtureIdentity(query,id) });
  await qualifyCIHistoricalProtection({db,query,pass});
  await qualifyRuntimeTablePrivileges({ query, setCmIdentity: () => query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
    ['10000000-0000-0000-0000-000000000001', JSON.stringify({ sub: '10000000-0000-0000-0000-000000000001', role: 'authenticated', is_anonymous: false })]) });
  console.log(JSON.stringify({ results, passed: results.length }));
} catch (error) {
  console.error(JSON.stringify({ results, failure: error.message, code: error.code }));
  process.exitCode = 1;
} finally {
  await db.close();
}
}

export async function runCases({ db, query, pass, deny, fixtureReady = false, registerFixtureIdentity }) {
  if (!fixtureReady) await db.exec(fs.readFileSync(path.join(root, 'supabase/tests/runtime_writer_authorization_test.sql'), 'utf8'));
  const CM = '10000000-0000-0000-0000-000000000001';
  const A = '10000000-0000-0000-0000-000000000002';
  const B = '10000000-0000-0000-0000-000000000003';
  const ADMIN = '10000000-0000-0000-0000-000000000004';
  const hash = value => createHash('sha256').update(value).digest('hex');
  const provenance = hash('synthetic-provenance');
  const state = (id, time = 0, lifecycle = 'RUNNING') => ({
    exerciseSession: { exerciseId: id, lifecycleState: lifecycle, simulationTimeSec: time, speed: 1, version: 1 },
    exercisePackageReference: { packageId: 'writer-auth-synthetic', packageVersion: '1.0.0' },
    patientMaterialization: { packageHash: 'synthetic' },
    patients: [{ id: 'PT-001', name: 'Synthetic' }], runtimePatientCommandCursor: 0,
  });
  async function identity(user) {
    await query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [user, JSON.stringify({ sub: user, role: 'authenticated', is_anonymous: false })]);
  }
  async function asUser(user, action) {
    await identity(user);
    await db.exec('set role authenticated');
    try {
      assert.equal((await query('select current_user')).rows[0].current_user, 'authenticated');
      return await action();
    } finally { await db.exec('reset role'); }
  }
  let sequence = 0;
  async function fixture() {
    const id = `EX-WRITER-AUTH-${++sequence}`;
    if (registerFixtureIdentity) await registerFixtureIdentity(id);
    for (const [user, role] of [[CM, 'CM'], [A, 'EXCON'], [B, 'EXCON']]) {
      await query(`insert into public.authorization_role_assignments
        (user_id,role,scope_type,scope_id,status,issued_by) values($1,$2,'EXERCISE',$3,'ACTIVE',$1)`, [user, role, id]);
    }
    await identity(A);
    await query('insert into public.exercise_states(exercise_id,revision,state,updated_by) values($1,1,$2,$3)', [id, state(id), A]);
    return id;
  }
  const acquire = async (user, id, writer = 'writer-a', revision = 0) =>
    (await asUser(user, () => query('select * from public.acquire_runtime_writer($1,$2,$3,60)', [id, writer, revision]))).rows[0];
  const renew = (user, lease, writer = 'writer-a') => asUser(user, () =>
    query('select * from public.renew_runtime_writer($1,$2,60)', [lease.lease_id, writer]));
  const publish = (user, id, lease, revision = 1, time = 0, lifecycle = 'RUNNING', command) => {
    const text = JSON.stringify(state(id, time, lifecycle));
    return asUser(user, () => command
      ? query('select * from public.finalize_runtime_completion_canonical_payload($1,$2,$3,$4,$5,$6,1,$7,$8,1,$9)',
        [id, command, lease.lease_id, 'writer-a', revision - 1, revision, hash(text), provenance, text])
      : query('select * from public.publish_runtime_checkpoint_canonical_payload($1,$2,$3,$4,$5,1,$6,$7,1,$8)',
        [lease.lease_id, 'writer-a', revision - 1, id, revision, hash(text), provenance, text]));
  };
  const takeover = (user, id, lease) => asUser(user, () =>
    query('select * from public.takeover_runtime_writer($1,$2,$3,60)', [id, 'writer-b', lease.lease_id]));
  const projection = (user, id, lease, revision = 1) => asUser(user, () =>
    query('select * from public.publish_exercise_state_current_writer($1,$2,$3,$4,$5,$6)',
      [id, `operation-${sequence}`, lease.lease_id, 'writer-a', revision, state(id, 10)]));
  async function legacyCmLease(id) {
    const lease = await acquire(A, id);
    await publish(A, id, lease);
    // Privileged fixture only: model a lease left by the old vulnerable policy.
    await identity(A);
    await query('update public.runtime_writer_leases set writer_user_id=$1 where exercise_id=$2', [CM, id]);
    return lease;
  }
  async function fingerprint(id) {
    return (await query(`select jsonb_build_object(
      'lease',(select to_jsonb(l) from public.runtime_writer_leases l where exercise_id=$1),
      'checkpoint',(select to_jsonb(c) from public.runtime_checkpoints c where exercise_id=$1),
      'projection',(select to_jsonb(e) from public.exercise_states e where exercise_id=$1),
      'completion',(select to_jsonb(r) from public.runtime_completion_requests r where exercise_id=$1),
      'artifact',(select to_jsonb(a) from public.runtime_checkpoint_canonical_artifacts a where exercise_id=$1),
      'commands',(select jsonb_agg(to_jsonb(c) order by command_sequence) from public.runtime_patient_commands c where exercise_id=$1)
    ) as value`, [id])).rows[0].value;
  }
  const deniedUnchanged = async (name, id, action, expected = /AUTHORIZATION_DENIED/) => {
    const before = await fingerprint(id);
    await deny(name, action, expected);
    assert.deepEqual(await fingerprint(id), before, `${name}: unauthorized RPC changed authoritative state`);
  };
  async function seedCommand(id) {
    await asUser(A, () => query('select * from public.ensure_shared_workflow_patient_head($1,$2)', [id, 'PT-001']));
    return (await query(`insert into public.runtime_patient_commands
      (exercise_id,patient_id,command_id,command_type,command_payload,patient_base_revision,
       patient_resulting_revision,simulation_time_sec,actor_user_id)
      values($1,'PT-001','SYNTHETIC-INTENT','MTP','{}',0,1,0,$2) returning command_sequence`, [id, CM])).rows[0].command_sequence;
  }
  {
    const id = await fixture();
    await deniedUnchanged('CM available lease denied', id, () => acquire(CM, id));
    await deniedUnchanged('PLATFORM_ADMIN alone denied', id, () => acquire(ADMIN, id));
    const lease = await acquire(A, id);
    await pass('EXCON acquisition and heartbeat allowed', async () => { assert.ok(lease.lease_id); await renew(A, lease); });
    await identity(A);
    await query(`update public.runtime_writer_leases set acquired_at=now()-interval '2 minutes',
      expires_at=now()-interval '1 minute' where exercise_id=$1`, [id]);
    await deniedUnchanged('CM expired lease replacement denied', id, () => acquire(CM, id));
    await pass('EXCON expired lease recovery increments generation', async () => {
      const old = (await query('select writer_generation from public.runtime_writer_leases where exercise_id=$1', [id])).rows[0];
      await acquire(B, id, 'writer-b');
      const next = (await query('select writer_generation from public.runtime_writer_leases where exercise_id=$1', [id])).rows[0];
      assert.equal(Number(next.writer_generation), Number(old.writer_generation) + 1);
    });
  }
  {
    const id = await fixture(), lease = await legacyCmLease(id);
    const commandSequence = await seedCommand(id);
    await deniedUnchanged('CM legacy lease heartbeat denied', id, () => renew(CM, lease));
    await deniedUnchanged('CM canonical checkpoint denied', id, () => publish(CM, id, lease, 2));
    await deniedUnchanged('CM canonical clock advance denied', id, () => publish(CM, id, lease, 2, 999));
    await deniedUnchanged('CM projection/control denied', id, () => projection(CM, id, lease), /UNAUTHORIZED/);
    await deniedUnchanged('CM active takeover denied', id, () => takeover(CM, id, lease), /UNAUTHORIZED/);
    await deniedUnchanged('CM cannot acknowledge materialization with legacy lease', id, () => asUser(CM, () => query(
      "select public.record_runtime_patient_command_result($1,$2,$3,'writer-a','MATERIALIZED','{}')", [id, commandSequence, lease.lease_id])));
    const payload = state(id, 999), text = JSON.stringify(payload);
    const envelope = { exerciseId: id, checkpointRevision: 2, persistedRuntimeVersion: 1,
      payloadHash: hash(text), provenanceHash: provenance, payload };
    const existing = await fingerprint(id);
    const delta = { deltaVersion: 1, exerciseId: id, fromRevision: 1, toRevision: 2,
      baseHash: existing.checkpoint.payload_hash, targetHash: hash(text), targetProvenanceHash: provenance,
      targetPersistedRuntimeVersion: 1 };
    const wrappers = [
      ['metadata', 'select * from public.publish_runtime_checkpoint_metadata($1,$2,1,$3)', [lease.lease_id, 'writer-a', envelope]],
      ['delta', 'select * from public.publish_runtime_checkpoint_delta($1,$2,1,$3,$4)', [lease.lease_id, 'writer-a', envelope, delta]],
      ['canonical fallback', 'select * from public.publish_runtime_checkpoint_canonical($1,$2,1,$3,1,$4)', [lease.lease_id, 'writer-a', envelope, text]],
      ['canonical delta fallback', 'select * from public.publish_runtime_checkpoint_canonical_delta($1,$2,1,$3,$4,1,$5)', [lease.lease_id, 'writer-a', envelope, delta, text]],
      ['canonical payload delta', 'select * from public.publish_runtime_checkpoint_canonical_payload_delta($1,$2,1,$3,$4,2,1,$5,$6,1,$7)', [lease.lease_id, 'writer-a', delta, id, hash(text), provenance, text]],
    ];
    for (const [name, sql, args] of wrappers) await deniedUnchanged(`CM ${name} wrapper denied`, id,
      () => asUser(CM, () => query(sql, args)));
  }
  {
    const id = await fixture(), lease = await acquire(A, id);
    await pass('EXCON canonical checkpoint and clock allowed', async () => {
      await publish(A, id, lease, 1, 42);
      const value = (await query('select payload from public.runtime_checkpoints where exercise_id=$1', [id])).rows[0].payload;
      assert.equal(value.payload.exerciseSession.simulationTimeSec, 42);
    });
    await pass('EXCON projection allowed', () => projection(A, id, lease));
    const commandSequence = await seedCommand(id);
    for (const [name, leaseId, instance] of [
      ['NULL lease', null, 'writer-a'],
      ['NULL instance', lease.lease_id, null],
      ['both NULL', null, null],
      ['empty instance', lease.lease_id, ''],
      ['wrong lease', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'writer-a'],
      ['wrong instance', lease.lease_id, 'writer-not-current'],
    ]) {
      await deniedUnchanged(`EXCON materialization rejects ${name}`, id, () => asUser(A, () => query(
        "select public.record_runtime_patient_command_result($1,$2,$3,$4,'MATERIALIZED','{}')",
        [id, commandSequence, leaseId, instance])), /STALE_WRITER/);
    }
    await pass('EXCON materialization acknowledgement allowed', async () => {
      await asUser(A, () => query("select public.record_runtime_patient_command_result($1,$2,$3,'writer-a','MATERIALIZED','{}')", [id, commandSequence, lease.lease_id]));
      assert.equal((await query('select status from public.runtime_patient_commands where command_sequence=$1', [commandSequence])).rows[0].status, 'MATERIALIZED');
    });
    await deniedUnchanged('invalid canonical hash remains rejected', id, () => asUser(A, () => query(
      'select * from public.publish_runtime_checkpoint_canonical_payload($1,$2,1,$3,2,1,$4,$5,1,$6)',
      [lease.lease_id, 'writer-a', id, '0'.repeat(64), provenance, JSON.stringify(state(id))])), /CANONICAL_CHECKPOINT_HASH_INVALID/);
    if (registerFixtureIdentity) await registerFixtureIdentity('EX-UNASSIGNED');
    await deniedUnchanged('wrong exercise scope denied', id, () => acquire(A, 'EX-UNASSIGNED'), /AUTHORIZATION_DENIED|EXERCISE_NOT_FOUND|EXERCISE_TERMINAL/);
    await deniedUnchanged('stale checkpoint revision denied', id, () => publish(A, id, lease, 1), /CHECKPOINT_REVISION_CONFLICT/);
    const before = (await query('select writer_generation from public.runtime_writer_leases where exercise_id=$1', [id])).rows[0];
    await pass('EXCON active takeover allowed', async () => { await takeover(B, id, lease); });
    const after = (await query('select writer_generation from public.runtime_writer_leases where exercise_id=$1', [id])).rows[0];
    assert.equal(Number(after.writer_generation), Number(before.writer_generation) + 1);
    await deniedUnchanged('C11 old projection writer fenced', id, () => projection(A, id, lease, 2), /WRITER_GENERATION_STALE/);
    await deniedUnchanged('old checkpoint writer fenced', id, () => publish(A, id, lease, 2), /STALE_WRITER/);
  }
  for (const status of ['revoked', 'expired', 'wrong-scope']) {
    const id = await fixture(), lease = await acquire(A, id);
    await publish(A, id, lease);
    if (status === 'revoked') await query(`update public.authorization_role_assignments set status='REVOKED',revoked_at=now(),revoked_by=$1 where user_id=$1 and scope_id=$2`, [A, id]);
    if (status === 'expired') await query(`update public.authorization_role_assignments set issued_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where user_id=$1 and scope_id=$2`, [A, id]);
    if (status === 'wrong-scope') {
      if (registerFixtureIdentity) await registerFixtureIdentity(`${id}-OTHER`);
      await query(`update public.authorization_role_assignments set scope_id=$2 where user_id=$1 and scope_id=$3`, [A, `${id}-OTHER`, id]);
    }
    await deniedUnchanged(`${status} EXCON acquisition denied`, id, () => acquire(A, id, 'writer-a', 1));
    await deniedUnchanged(`${status} EXCON heartbeat denied`, id, () => renew(A, lease));
    await deniedUnchanged(`${status} EXCON checkpoint denied`, id, () => publish(A, id, lease, 2));
  }
  {
    const id = await fixture();
    await query('update public.exercise_states set state=$2 where exercise_id=$1', [id, state(id, 0, 'COMPLETED')]);
    await deniedUnchanged('terminal lifecycle denies acquisition', id, () => acquire(A, id), /EXERCISE_TERMINAL|EXERCISE_NOT_ACTIVE/);
  }
  {
    const id = await fixture();
    await pass('CM patient ownership and mutable workflow remain allowed', async () => {
      await asUser(A, () => query('select * from public.ensure_shared_workflow_patient_head($1,$2)', [id, 'PT-001']));
      const claimed = (await asUser(CM, () => query(`select * from public.apply_shared_workflow_patient_mutation(
        $1,$2,'CM-CLAIM','CLAIM',0,null,$3,$4)`, [id, 'PT-001', CM, { patient: { id: 'PT-001' } }]))).rows[0];
      assert.equal(claimed.status, 'APPLIED');
      const changed = (await asUser(CM, () => query(`select * from public.apply_shared_workflow_patient_mutation(
        $1,$2,'CM-UPDATE','MUTABLE',1,$3,$3,$4)`, [id, 'PT-001', CM, { patient: { id: 'PT-001', location: 'ED' } }]))).rows[0];
      assert.equal(changed.status, 'APPLIED');
    });
    await pass('CM same-base APPEND, clinical command and release survive privilege removal', async () => {
      for (const command of ['CM-APPEND-A','CM-APPEND-B']) {
        const appended = (await asUser(CM, () => query(`select * from public.apply_shared_workflow_patient_mutation(
          $1,'PT-001',$2,'APPEND',2,$3,$3,$4)`, [id, command, CM, { notes: [{ id: command, text: 'Synthetic' }] }]))).rows[0];
        assert.equal(appended.status, 'APPLIED');
      }
      const head = (await query("select * from public.shared_workflow_patient_states where exercise_id=$1 and patient_id='PT-001'", [id])).rows[0];
      assert.equal(Number(head.revision),4); assert.equal(head.state.notes.length,2);
      const submitted = (await asUser(CM, () => query(`select * from public.submit_runtime_patient_command(
        $1,'PT-001','CM-CLINICAL','MTP',4,0,'{}')`, [id]))).rows[0];
      assert.equal(submitted.status,'APPLIED');
      const released = (await asUser(CM, () => query(`select * from public.apply_shared_workflow_patient_mutation(
        $1,'PT-001','CM-RELEASE','RELEASE',5,$2,null,$3)`, [id, CM, head.state]))).rows[0];
      assert.equal(released.status,'APPLIED'); assert.equal(released.owner_user_id,null);
    });
    await pass('trusted administrative listing, scoped grant and revoke retain their SQL contract', async () => {
      await db.exec('set role service_role');
      try {
        const listed = await query('select exercise_id from public.exercise_states where exercise_id=$1', [id]);
        assert.equal(listed.rows[0].exercise_id,id);
        const granted = (await query("select * from public.trusted_admin_grant_exercise_role($1,$2,'CM',$3,null)", [ADMIN,id,ADMIN])).rows[0];
        assert.equal(granted.status,'ACTIVE'); assert.equal(granted.scope_id,id);
        const revoked = (await query('select * from public.trusted_admin_revoke_exercise_role($1,$2,$3)', [granted.id,id,ADMIN])).rows[0];
        assert.equal(revoked.status,'REVOKED');
      } finally { await db.exec('reset role'); }
    });
  }
  {
    // Same authenticated controller, different writer generation: role/user
    // equality must not let the former instance acknowledge commands.
    const id = await fixture(), previous = await acquire(A, id);
    await publish(A, id, previous);
    const commandSequence = await seedCommand(id);
    const current = (await takeover(A, id, previous)).rows[0];
    for (const [name, leaseId, instance] of [
      ['previous lease and instance', previous.lease_id, 'writer-a'],
      ['current lease and previous instance', current.lease_id, 'writer-a'],
      ['previous lease and current instance', previous.lease_id, 'writer-b'],
      ['NULL lease after takeover', null, 'writer-b'],
      ['NULL instance after takeover', current.lease_id, null],
      ['both NULL after takeover', null, null],
    ]) {
      await deniedUnchanged(`same-user generation rejects ${name}`, id, () => asUser(A, () => query(
        "select public.record_runtime_patient_command_result($1,$2,$3,$4,'MATERIALIZED','{}')",
        [id, commandSequence, leaseId, instance])), /STALE_WRITER/);
    }
    await pass('same-user current generation materializes once', async () => {
      const args = [id, commandSequence, current.lease_id, 'writer-b'];
      const sql = "select public.record_runtime_patient_command_result($1,$2,$3,$4,'MATERIALIZED','{}')";
      await asUser(A, () => query(sql, args));
      const first = await fingerprint(id);
      await asUser(A, () => query(sql, args));
      assert.deepEqual(await fingerprint(id), first);
      assert.equal(first.commands[0].status, 'MATERIALIZED');
    });
  }
  {
    const id = await fixture(), lease = await legacyCmLease(id), command = 'COMPLETE-ORIGINAL';
    await deniedUnchanged('CM cannot initiate completion', id, () => asUser(CM, () => query(
      'select * from public.submit_runtime_completion_request($1,$2,1)', [id, command])), /AUTHORIZATION_DENIED/);
    await asUser(A, () => query('select * from public.submit_runtime_completion_request($1,$2,1)', [id, command]));
    await deniedUnchanged('CM cannot finalize PENDING even with legacy lease', id, () => publish(CM, id, lease, 2, 42, 'COMPLETED', command));
    await identity(A);
    await query(`update public.runtime_writer_leases set released_at=now() where exercise_id=$1`, [id]);
    const recovered = await acquire(B, id, 'writer-a', 1);
    await deniedUnchanged('PENDING finalization fences old writer generation', id, () => publish(CM, id, lease, 2, 42, 'COMPLETED', command), /STALE_WRITER/);
    await deniedUnchanged('PENDING recovery cannot create new operation', id, () => publish(B, id, recovered, 2, 42, 'COMPLETED', 'NEW-OPERATION'), /COMPLETION_REQUEST_NOT_FOUND/);
    await deniedUnchanged('PENDING fences arbitrary checkpoint publication', id, () => publish(B, id, recovered, 2, 999), /COMPLETION_FENCED/);
    await pass('EXCON PENDING recovery preserves operation and completes once', async () => {
      await publish(B, id, recovered, 2, 42, 'COMPLETED', command);
      await publish(B, id, recovered, 2, 42, 'COMPLETED', command); // lost-response retry
      const value = await fingerprint(id);
      assert.equal(value.completion.command_id, command);
      assert.equal(value.completion.status, 'COMPLETED');
      assert.equal(value.checkpoint.checkpoint_revision, 2);
      assert.equal(value.projection.state.exerciseSession.lifecycleState, 'COMPLETED');
      assert.ok(value.lease.released_at);
    });
  }
}
