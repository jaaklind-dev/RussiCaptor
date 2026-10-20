import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { Buffer } from 'node:buffer';

// Only the disposable native qualification database, never a supplied URL.
const socket = fs.realpathSync(process.env.WRITER_AUTH_NATIVE_SOCKET || '/missing-socket');
assert.match(socket, /^\/private\/tmp\/russicaptor-pg176\.[A-Za-z0-9]+\/socket$/);
assert.equal(fs.statSync(socket).uid, process.getuid());
assert.equal(fs.statSync(socket).mode & 0o077, 0);
const require = createRequire(import.meta.url);
const { Client } = require(process.env.WRITER_AUTH_PG_MODULE || 'pg');
const config = { host: socket, port: 5432, user: 'postgres', database: 'russicaptor_m54_qual',
  application_name: 'm54-transaction-qualification', connectionTimeoutMillis: 5000 };
const client = new Client(config);
const query = (text, args) => client.query(text, args);
const results = [];
const root = process.cwd();
const cli = process.env.WRITER_AUTH_SUPABASE_CLI;
assert.ok(cli && path.isAbsolute(cli));
// One isolated scenario per invocation; the operator provisions a fresh cluster.
const scenario = Number(process.env.WRITER_AUTH_TRANSACTION_SCENARIO);
assert.ok(Number.isInteger(scenario) && scenario >= 0 && scenario <= 7, 'explicit scenario 0..7 required (6 observes, 7 rehearses concurrency)');
const serverLog = fs.realpathSync(process.env.WRITER_AUTH_NATIVE_SERVER_LOG || '/missing-server-log');
assert.ok(serverLog.startsWith(`${path.dirname(socket)}/`));
const execute = promisify(execFile);
const migrate = async (port = 5432) => {
  const url = new URL(`postgresql://postgres@localhost:${port}/russicaptor_m54_qual`);
  url.searchParams.set('host', socket);
  url.searchParams.set('sslmode', 'disable');
  const startedAt = new Date().toISOString();
  const logOffset = fs.statSync(serverLog).size;
  const job = execute(cli, ['db', 'push', '--db-url', url.href, '--skip-vault', '--yes', '--workdir', root],
    { env: { ...process.env, DO_NOT_TRACK: '1' }, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  let spawned = false;
  job.child.once('spawn', () => { spawned = true; });
  try {
    const result = await job;
    console.log(JSON.stringify({ processEvidence: { command: 'supabase db push --db-url <private UNIX socket> --skip-vault --yes',
      scenario, startedAt, finishedAt: new Date().toISOString(), spawned, pid: job.child.pid,
      exitCode: 0, signal: null, ...result } }));
    return result;
  } catch (error) {
    const structured = [];
    for (const line of String(error.stdout ?? '').split('\n').filter(Boolean)) {
      try { structured.push(JSON.parse(line)); } catch { /* Raw stdout is preserved independently. */ }
    }
    error.capture = { command: 'supabase db push --db-url <private UNIX socket> --skip-vault --yes',
      scenario, startedAt, finishedAt: new Date().toISOString(), spawned, pid: job.child.pid,
      exitCode: typeof error.code === 'number' ? error.code : null,
      signal: error.signal ?? null, errorName: error.name, errorCode: error.code,
      stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? ''), structured,
      serverLog: fs.readFileSync(serverLog).subarray(logOffset).toString('utf8') };
    console.log(JSON.stringify({ processEvidence: error.capture }));
    throw error;
  }
};
const baselineFunction = (file, name) => {
  const text = fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8');
  const found = text.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i'));
  assert.ok(found, `missing historical definition: ${name}`);
  return found[0];
};
const oldSql = [
  baselineFunction('20260829124632_production_operator_identity_authorization.sql', 'enforce_runtime_operator_scope'),
  baselineFunction('20260907162401_narva_multicm_terminal_convergence.sql', 'record_runtime_patient_command_result'),
].join('\n');
const catalog = async () => (await query(`select jsonb_build_object(
  'functions',(select jsonb_agg(jsonb_build_object('name',proname,'definition',pg_get_functiondef(oid),
    'acl',proacl::text,'owner',pg_get_userbyid(proowner)) order by proname) from pg_proc where oid in
    ('public.enforce_runtime_operator_scope()'::regprocedure,
     'public.record_runtime_patient_command_result(text,bigint,uuid,text,text,jsonb)'::regprocedure)),
  'ledger',(select jsonb_agg(to_jsonb(m) order by version) from supabase_migrations.schema_migrations m),
  'triggers',(select jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',tgenabled) order by tgname)
    from pg_trigger t where not tgisinternal and tgrelid in
    ('public.runtime_writer_leases'::regclass,'public.runtime_checkpoints'::regclass)),
  'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'),
  'leases',(select jsonb_agg(to_jsonb(t) order by exercise_id) from public.runtime_writer_leases t),
  'checkpoints',(select jsonb_agg(to_jsonb(t) order by exercise_id) from public.runtime_checkpoints t),
  'artifacts',(select jsonb_agg(to_jsonb(t) order by exercise_id) from public.runtime_checkpoint_canonical_artifacts t),
  'commands',(select jsonb_agg(to_jsonb(t) order by exercise_id,command_id) from public.runtime_patient_commands t),
  'completions',(select jsonb_agg(to_jsonb(t) order by exercise_id) from public.runtime_completion_requests t),
  'exercises',(select jsonb_agg(to_jsonb(t) order by exercise_id) from public.exercise_states t)) as value`)).rows[0].value;
const resetTo53 = async () => {
  // Controlled reconstruction of the historical baseline in this synthetic DB
  // only. Never a rollback proposal for production or the candidate SQL file.
  await query(`begin; ${oldSql}
    delete from supabase_migrations.schema_migrations where version='20261019171013'; commit;`);
  assert.equal((await query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n, 53);
};
const cleanInjection = () => query(`drop event trigger if exists m54_inject_ddl;
  drop trigger if exists m54_inject_ledger on supabase_migrations.schema_migrations;
  drop function if exists public.m54_inject_ddl(); drop function if exists public.m54_inject_ledger();`);
try {
  await client.connect();
  const version = (await query("select version(),current_setting('server_version_num') n,inet_server_addr() address")).rows[0];
  assert.equal(version.n, '170006'); assert.equal(version.address, null);
  console.log(JSON.stringify({ version, scope: 'synthetic native qualification only; actual Supabase CLI' }));
  for (const [index, [name, injection, expected]] of [
    ['failure before first function replacement', `create function public.m54_inject_ddl() returns event_trigger language plpgsql as $$
      begin if tg_tag='CREATE FUNCTION' then raise exception 'M54_BEFORE_SQL' using errcode='P0001'; end if; end $$;
      create event trigger m54_inject_ddl on ddl_command_start execute function public.m54_inject_ddl();`, /M54_BEFORE_SQL/],
    ['failure during second function replacement', `create function public.m54_inject_ddl() returns event_trigger language plpgsql as $$
      begin if exists(select 1 from pg_event_trigger_ddl_commands() where object_identity like '%record_runtime_patient_command_result%')
      then raise exception 'M54_DURING_SQL' using errcode='P0001'; end if; end $$;
      create event trigger m54_inject_ddl on ddl_command_end execute function public.m54_inject_ddl();`, /M54_DURING_SQL/],
    ['ledger insert failure after function replacements', `create function public.m54_inject_ledger() returns trigger language plpgsql as $$
      begin if new.version='20261019171013' then raise exception 'M54_LEDGER_FAILURE' using errcode='P0001'; end if; return new; end $$;
      create trigger m54_inject_ledger before insert on supabase_migrations.schema_migrations for each row execute function public.m54_inject_ledger();`, /M54_LEDGER_FAILURE/],
  ].entries()) {
    if (index !== scenario) continue;
    await resetTo53();
    await query(injection);
    const before = await catalog();
    let failure;
    try { await migrate(); } catch (error) { failure = error; }
    assert.ok(failure, `${name}: CLI unexpectedly reported success`);
    assert.equal(failure.capture.spawned, true);
    assert.ok(Number.isInteger(failure.capture.exitCode) && failure.capture.exitCode !== 0);
    assert.equal(failure.capture.signal, null, 'unexpected process termination is not injected SQL failure');
    assert.match(failure.capture.stderr, /Applying migration 20261019171013_runtime_writer_controller_authorization\.sql/);
    assert.match(`${failure.capture.stdout}\n${failure.capture.stderr}`, expected);
    assert.match(failure.capture.serverLog, expected);
    assert.match(failure.capture.serverLog, /P0001/);
    assert.match(failure.capture.serverLog, /m54_inject_(ddl|ledger)/);
    const after = await catalog();
    assert.equal(after.ledger.length, 53);
    assert.deepEqual(after, before, `${name}: SQL, ACL, triggers, policies or data partially committed`);
    const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    results.push({ name, status: 'PASS', sqlstate: 'P0001', beforeSha256: digest(before), afterSha256: digest(after),
      schemaAclTriggersPoliciesDataLedgerUnchanged: true });
    console.log(JSON.stringify(results.at(-1)));
    await cleanInjection();
    assert.equal((await query("select count(*)::int n from pg_event_trigger where evtname='m54_inject_ddl'")).rows[0].n, 0);
  }
  if (scenario === 3) {
  await resetTo53();
  await query('begin; lock table supabase_migrations.schema_migrations in access exclusive mode');
  const timed = new Client(config);
  await timed.connect();
  // ALTER DATABASE affects only new CLI connections, not this existing blocker.
  await timed.query("alter database russicaptor_m54_qual set lock_timeout='1s'");
  await timed.query("alter database russicaptor_m54_qual set statement_timeout='5s'");
  const blockedBefore = await catalog();
  let lockFailure;
  try { await migrate(); } catch (error) { lockFailure = error; }
  await query('rollback');
  await timed.query('alter database russicaptor_m54_qual reset lock_timeout');
  await timed.query('alter database russicaptor_m54_qual reset statement_timeout');
  await timed.end();
  assert.ok(lockFailure);
  assert.match(`${lockFailure.message}\n${lockFailure.stderr}`, /lock timeout|55P03/i);
  assert.deepEqual(await catalog(), blockedBefore);
  results.push({ name: 'bounded ledger lock timeout preserves schema and ledger', status: 'PASS', failure: lockFailure.stderr });
  console.log(JSON.stringify(results.at(-1)));
  }
  if (scenario === 4) {
    await resetTo53();
    await query(`create function public.m54_inject_ledger() returns trigger language plpgsql as $$
      begin if new.version='20261019171013' then perform pg_advisory_xact_lock(54,54); end if; return new; end $$;
      create trigger m54_inject_ledger before insert on supabase_migrations.schema_migrations
      for each row execute function public.m54_inject_ledger();`);
    const before = await catalog();
    await query('select pg_advisory_lock(54,54)');
    const attempt = migrate().then(value => ({ value }), failure => ({ failure }));
    let blocked;
    const deadline = Date.now() + 5000;
    while (!blocked && Date.now() < deadline) {
      blocked = (await query("select pid from pg_locks where locktype='advisory' and classid=54 and objid=54 and not granted")).rows[0];
      if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(blocked, 'CLI never reached blocked pre-commit ledger insertion');
    assert.equal((await query('select pg_terminate_backend($1) terminated', [blocked.pid])).rows[0].terminated, true);
    const outcome = await attempt;
    await query('select pg_advisory_unlock(54,54)');
    assert.ok(outcome.failure, 'connection loss before commit unexpectedly reported success');
    assert.equal(outcome.failure.capture.spawned, true);
    assert.match(outcome.failure.capture.serverLog, /57P01/);
    assert.deepEqual(await catalog(), before);
    await cleanInjection();
    results.push({ name: 'connection loss at pre-commit ledger gate rolls back SQL, ACL, data and ledger',
      status: 'PASS', sqlstate: '57P01', blockedBackend: blocked.pid, ledger: 53 });
    console.log(JSON.stringify(results.at(-1)));
  }
  if (scenario === 5 || scenario === 6) {
    const expectedCommitted = await catalog();
    await resetTo53();
    // The audited CLI PgBatchQuery sends one extended-protocol batch followed
    // by Sync. PostgreSQL commits at Sync and the driver succeeds only upon
    // ReadyForQuery. Hold that exact idle response, independently reconcile
    // committed state, then close without forwarding it. SQL is never changed.
    const proxyPath = path.join(socket, '.s.PGSQL.5433');
    assert.equal(fs.existsSync(proxyPath), false);
    let armed = false;
    let commitAcknowledgmentDropped = false;
    let acknowledgmentVerification;
    let verificationError;
    let withheldBoundary;
    const connections = new Set();
    const proxyErrors = [];
    const trace = [];
    let sequence = 0;
    let nextConnection = 0;
    const record = (connection, direction, type, size, metadata = {}) => {
      assert.ok(trace.length < 512, 'bounded protocol trace exceeded');
      const entry = { sequence: ++sequence, connection, direction, type, size, ...metadata };
      trace.push(entry);
      console.log(JSON.stringify({ protocol: entry }));
    };
    const proxy = net.createServer(front => {
      const connectionId = ++nextConnection;
      const back = net.createConnection({ path: path.join(socket, '.s.PGSQL.5432') });
      connections.add(front); connections.add(back);
      let pending = Buffer.alloc(0);
      let frontend = Buffer.alloc(0);
      let startup = true;
      let candidateSeen = false;
      let ledgerSeen = false;
      let batchSyncSeen = false;
      const batchTags = [];
      front.on('data', chunk => {
        frontend = Buffer.concat([frontend, chunk]);
        while (frontend.length >= (startup ? 4 : 5)) {
          const length = frontend.readUInt32BE(startup ? 0 : 1);
          assert.ok(length >= 4 && length <= 16 * 1024 * 1024, 'invalid frontend frame');
          const size = length + (startup ? 0 : 1);
          if (frontend.length < size) break;
          const message = frontend.subarray(0, size);
          frontend = frontend.subarray(size);
          const type = startup ? 'Startup' : String.fromCharCode(message[0]);
          const metadata = {};
          if (type === 'Q' || type === 'P') {
            const offset = type === 'P' ? message.indexOf(0, 5) + 1 : 5;
            const end = message.indexOf(0, offset);
            const sql = message.subarray(offset, end).toString('utf8');
            const trimmed = sql.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/, '').trim();
            metadata.statementClass = trimmed.match(/^[a-z]+(?:\s+[a-z]+)?/i)?.[0].toUpperCase() ?? 'OTHER';
            metadata.candidate = sql.includes('record_runtime_patient_command_result') && sql.includes('EXCON_EXERCISE_CONTROL');
            metadata.ledgerInsert = /insert\s+into\s+supabase_migrations\.schema_migrations/i.test(sql);
            if (metadata.candidate) { armed = true; candidateSeen = true; }
            if (metadata.ledgerInsert && candidateSeen) ledgerSeen = true;
          }
          if (type === 'S' && candidateSeen && ledgerSeen) batchSyncSeen = true;
          record(connectionId, 'client-server', type, size, metadata);
          startup = false;
        }
        back.write(chunk);
      });
      back.on('data', chunk => {
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= 5) {
          const length = pending.readUInt32BE(1);
          if (length < 4 || length > 16 * 1024 * 1024) {
            proxyErrors.push('invalid server frame'); front.destroy(); back.destroy(); return;
          }
          if (pending.length < length + 1) return;
          const message = pending.subarray(0, length + 1);
          pending = pending.subarray(length + 1);
          const type = String.fromCharCode(message[0]);
          const metadata = {};
          if (type === 'C') metadata.commandTag = message.subarray(5, -1).toString('utf8');
          if (type === 'Z') metadata.transactionStatus = String.fromCharCode(message[5]);
          if (type === 'K') metadata.backendPid = message.readUInt32BE(5); // Never record the cancellation secret.
          record(connectionId, 'server-client', type, message.length, metadata);
          if (candidateSeen && type === 'C') batchTags.push(metadata.commandTag);
          if (scenario === 5 && candidateSeen && ledgerSeen && batchSyncSeen && type === 'Z') {
            assert.equal(metadata.transactionStatus, 'I');
            assert.deepEqual(batchTags, ['CREATE FUNCTION', 'REVOKE', 'CREATE FUNCTION', 'REVOKE', 'GRANT', 'INSERT 0 1']);
            commitAcknowledgmentDropped = true;
            withheldBoundary = { connection: connectionId, sequence, type, transactionStatus: 'I',
              forwarded: false, batchTags: [...batchTags] };
            back.pause();
            acknowledgmentVerification = (async () => {
              assert.equal((await query("select current_setting('fsync') f,current_setting('synchronous_commit') s")).rows[0].f, 'on');
              assert.equal((await query("show synchronous_commit")).rows[0].synchronous_commit, 'on');
              const independentlyVisible = await catalog();
              assert.deepEqual(independentlyVisible, expectedCommitted,
                'committed ledger, both functions/owners/ACL, triggers, RLS or synthetic data differ');
              console.log(JSON.stringify({ commitVisibleBeforeDisconnect: true, ledger: 54,
                withheldBoundary, independentConnection: true, fsync: 'on', synchronousCommit: 'on',
                catalogSha256: createHash('sha256').update(JSON.stringify(independentlyVisible)).digest('hex') }));
            })().catch(error => { verificationError = error; }).finally(() => { front.destroy(); back.destroy(); });
            return;
          }
          front.write(message);
        }
      });
      for (const connection of [front, back]) {
        connection.on('error', error => { if (!commitAcknowledgmentDropped) proxyErrors.push(error.code); });
        connection.on('close', () => { connections.delete(connection); });
      }
      front.on('close', () => back.destroy());
      back.on('close', () => front.destroy());
    });
    await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(proxyPath, resolve); });
    let outcome;
    try { outcome = await migrate(5433).then(value => ({ value }), failure => ({ failure })); }
    finally {
      for (const connection of connections) connection.destroy();
      await new Promise(resolve => proxy.close(resolve));
    }
    assert.equal(armed, true);
    if (scenario === 6) {
      assert.deepEqual(proxyErrors, []);
      assert.ok(outcome.value, 'protocol observation failed');
      results.push({ name: 'bounded actual CLI protocol observation', status: 'PASS', frames: trace.length });
      console.log(JSON.stringify(results.at(-1)));
    } else {
    if (acknowledgmentVerification) await acknowledgmentVerification;
    if (verificationError) throw verificationError;
    assert.equal(commitAcknowledgmentDropped, true, 'actual migration ReadyForQuery was not withheld');
    assert.deepEqual(proxyErrors, []);
    assert.ok(outcome.failure, 'CLI did not expose the deliberately lost commit acknowledgment');
    assert.equal(outcome.failure.capture.spawned, true);
    assert.ok(Number.isInteger(outcome.failure.capture.exitCode) && outcome.failure.capture.exitCode !== 0);
    assert.equal(outcome.failure.capture.signal, null);
    assert.doesNotMatch(outcome.failure.capture.stdout, /Finished supabase db push/);
    assert.match(`${outcome.failure.capture.stdout}\n${outcome.failure.capture.stderr}`, /connection.*(terminated|lost|closed)/i);
    assert.equal(trace.filter(e => e.candidate).length, 1, 'migration was resubmitted before reconciliation');
    const committed = await catalog();
    assert.equal(committed.ledger.length, 54);
    assert.ok(committed.functions.find(f => f.name === 'enforce_runtime_operator_scope').definition.includes("'EXCON_EXERCISE_CONTROL'"));
    assert.ok(!committed.functions.find(f => f.name === 'enforce_runtime_operator_scope').definition.includes('CM_WORKFLOW_WRITE'));
    assert.deepEqual(committed, expectedCommitted);
    console.log(JSON.stringify({ reconciliation: 'A: fully committed; do not reapply migration',
      ledger: 54, functionsOwnersAclTriggersRlsDataVerified: true, writerGenerationsUnchanged: true }));
    const retry = await migrate();
    const retryResult = JSON.parse(retry.stdout.trim());
    assert.equal(retryResult.upToDate, true);
    assert.deepEqual(retryResult.migrations, []);
    assert.deepEqual(await catalog(), committed);
    results.push({ name: 'E/F: committed transaction with lost ReadyForQuery; reconciliation precedes no-op CLI check',
      status: 'PASS', commitAcknowledgmentDropped, withheldBoundary, ledger: 54, retryStdout: retry.stdout });
    console.log(JSON.stringify(results.at(-1)));
    }
  }
  if (scenario === 7) {
    const operation = process.env.WRITER_AUTH_CONCURRENT_OPERATION;
    assert.ok(['heartbeat', 'acquire', 'takeover', 'checkpoint', 'finalize'].includes(operation));
    const expectedFunctions = (await catalog()).functions;
    await resetTo53();
    const excon = '10000000-0000-0000-0000-000000000002';
    const replacement = '10000000-0000-0000-0000-000000000003';
    const cm = '10000000-0000-0000-0000-000000000001';
    const id = `EX-NATIVE-CONCURRENT-${operation}`;
    const setIdentity = (connection, user) => connection.query(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [user, JSON.stringify({ sub: user, role: 'authenticated', is_anonymous: false })]);
    for (const user of [excon, replacement, cm]) await query(`insert into public.authorization_role_assignments
      (user_id,role,scope_type,scope_id,status,issued_by) values($1,$2,'EXERCISE',$3,'ACTIVE',$1)`,
    [user, user === cm ? 'CM' : 'EXCON', id]);
    await setIdentity(client, excon);
    const state = (time, lifecycle = 'RUNNING') => ({ exerciseSession: { exerciseId: id, lifecycleState: lifecycle,
      simulationTimeSec: time, speed: 1, version: 1 },
    exercisePackageReference: { packageId: 'writer-auth-synthetic', packageVersion: '1.0.0' },
    patientMaterialization: { packageHash: 'synthetic' }, patients: [{ id: 'PT-001', name: 'Synthetic' }],
    runtimePatientCommandCursor: 0 });
    const hash = text => createHash('sha256').update(text).digest('hex');
    const provenance = hash('synthetic-provenance');
    await query('insert into public.exercise_states(exercise_id,revision,state,updated_by) values($1,1,$2,$3)', [id, state(0), excon]);
    let lease;
    if (operation !== 'acquire') {
      await query('set role authenticated');
      try {
        lease = (await query("select * from public.acquire_runtime_writer($1,'concurrent-writer',0,300)", [id])).rows[0];
        const text = JSON.stringify(state(0));
        await query("select * from public.publish_runtime_checkpoint_canonical_payload($1,'concurrent-writer',0,$2,1,1,$3,$4,1,$5)",
          [lease.lease_id, id, hash(text), provenance, text]);
        if (operation === 'finalize') await query("select * from public.submit_runtime_completion_request($1,'CONCURRENT-COMPLETION',1)", [id]);
      } finally { await query('reset role'); }
    }
    await query(`create function public.m54_inject_ledger() returns trigger language plpgsql as $$
      begin if new.version='20261019171013' then perform pg_advisory_xact_lock(54,54); end if; return new; end $$;
      create trigger m54_inject_ledger before insert on supabase_migrations.schema_migrations
      for each row execute function public.m54_inject_ledger();`);
    await query('select pg_advisory_lock(54,54)');
    const migration = migrate().then(value => ({ value }), failure => ({ failure }));
    let blocked;
    const deadline = Date.now() + 5000;
    while (!blocked && Date.now() < deadline) {
      blocked = (await query("select pid from pg_locks where locktype='advisory' and classid=54 and objid=54 and not granted")).rows[0];
      if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(blocked, 'migration never reached the controlled pre-commit gate');
    assert.equal((await catalog()).ledger.length, 53);
    const operator = new Client({ ...config, application_name: `m54-concurrent-${operation}` });
    await operator.connect();
    await operator.query("set statement_timeout='5s'; set lock_timeout='4s'");
    await setIdentity(operator, operation === 'takeover' ? replacement : excon);
    await operator.query('set role authenticated');
    const operatorPid = (await operator.query('select pg_backend_pid() pid')).rows[0].pid;
    const beforeOperation = await catalog();
    const authoritativeBase = Number(beforeOperation.checkpoints?.find(row => row.exercise_id === id)?.checkpoint_revision ?? 0);
    console.log(JSON.stringify({ concurrentPreparation: { operation, exercise: id, patient: 'PT-001',
      operatorRole: 'EXCON', operatorUser: operation === 'takeover' ? replacement : excon,
      operatorBackend: operatorPid, migrationBackend: blocked.pid, baseRevision: authoritativeBase,
      writerGeneration: beforeOperation.leases?.find(row => row.exercise_id === id)?.writer_generation ?? null,
      lifecycle: 'RUNNING', migrationLedger: beforeOperation.ledger.length } }));
    const text = JSON.stringify(state(15, operation === 'finalize' ? 'COMPLETED' : 'RUNNING'));
    const calls = {
      heartbeat: ["select * from public.renew_runtime_writer($1,'concurrent-writer',300)", [lease?.lease_id]],
      acquire: ["select * from public.acquire_runtime_writer($1,'concurrent-writer',$2,300)", [id, authoritativeBase]],
      takeover: ["select * from public.takeover_runtime_writer($1,'replacement-writer',$2,300)", [id, lease?.lease_id]],
      checkpoint: ["select * from public.publish_runtime_checkpoint_canonical_payload($1,'concurrent-writer',1,$2,2,1,$3,$4,1,$5)",
        [lease?.lease_id, id, hash(text), provenance, text]],
      finalize: ["select * from public.finalize_runtime_completion_canonical_payload($1,'CONCURRENT-COMPLETION',$2,'concurrent-writer',1,2,1,$3,$4,1,$5)",
        [id, lease?.lease_id, hash(text), provenance, text]],
    };
    let settled = false;
    const attempt = operator.query(...calls[operation]).then(value => ({ value }), failure => ({ failure }))
      .then(outcome => { settled = true; return outcome; });
    // A bounded scheduling window observes, not prescribes, real database order.
    await Promise.race([attempt, new Promise(resolve => setTimeout(resolve, 200))]);
    const locks = (await query(`select pid,state,wait_event_type,wait_event from pg_stat_activity
      where pid=any($1::int[]) order by pid`, [[blocked.pid, operatorPid]])).rows;
    const completedBeforeMigrationCommit = settled;
    console.log(JSON.stringify({ concurrentOrdering: { operation, locks, completedBeforeMigrationCommit,
      operatorBackend: operatorPid, migrationBackend: blocked.pid } }));
    await query('select pg_advisory_unlock(54,54)');
    const [migrationOutcome, operationOutcome] = await Promise.all([migration, attempt]);
    await operator.end();
    assert.ok(migrationOutcome.value, 'migration failed during concurrent authorized operation');
    assert.ok(operationOutcome.value, `authorized ${operation} failed: ${operationOutcome.failure?.code}`);
    await cleanInjection();
    const after = await catalog();
    assert.equal(after.ledger.length, 54);
    assert.deepEqual(after.functions, expectedFunctions);
    const finalLease = after.leases.find(row => row.exercise_id === id);
    const checkpoint = after.checkpoints?.find(row => row.exercise_id === id);
    const completion = after.completions?.find(row => row.exercise_id === id);
    assert.equal(Number(finalLease.writer_generation), operation === 'takeover' ? 2 : 1);
    assert.equal(Number(checkpoint?.checkpoint_revision ?? 0), ['checkpoint', 'finalize'].includes(operation) ? 2 : operation === 'acquire' ? 0 : 1);
    if (operation === 'finalize') {
      assert.equal(completion.status, 'COMPLETED');
      assert.equal(completion.command_id, 'CONCURRENT-COMPLETION');
      assert.ok(finalLease.released_at);
    }
    console.log(JSON.stringify({ concurrentCommitted: { operation, sqlstate: '00000', migrationCommitted: true,
      operatorCommitted: true, ledger: after.ledger.length, writerGeneration: finalLease.writer_generation,
      checkpointRevision: checkpoint?.checkpoint_revision ?? 0, completionStatus: completion?.status ?? null,
      responseRows: operationOutcome.value.rowCount } }));

    // A separate writer-free fixture isolates authorization from unrelated CAS,
    // active-owner and terminal-state checks. Seed a real checkpoint through
    // supported EXCON RPCs, release its lease, then read its actual revision.
    const negativeId = `${id}-CM-NEGATIVE`;
    for (const [user, role] of [[excon, 'EXCON'], [cm, 'CM']]) await query(`insert into public.authorization_role_assignments
      (user_id,role,scope_type,scope_id,status,issued_by) values($1,$2,'EXERCISE',$3,'ACTIVE',$1)`, [user, role, negativeId]);
    await setIdentity(client, excon);
    const negativeState = state(0);
    negativeState.exerciseSession.exerciseId = negativeId;
    await query('insert into public.exercise_states(exercise_id,revision,state,updated_by) values($1,1,$2,$3)',
      [negativeId, negativeState, excon]);
    await query('set role authenticated');
    try {
      const seedRevision = Number((await query('select coalesce((select checkpoint_revision from public.runtime_checkpoints where exercise_id=$1),0) revision', [negativeId])).rows[0].revision);
      const seeded = (await query("select * from public.acquire_runtime_writer($1,'negative-fixture-seed',$2,300)", [negativeId, seedRevision])).rows[0];
      const negativeText = JSON.stringify(negativeState);
      await query("select * from public.publish_runtime_checkpoint_canonical_payload($1,'negative-fixture-seed',$2,$3,$4,1,$5,$6,1,$7)",
        [seeded.lease_id, seedRevision, negativeId, seedRevision + 1, hash(negativeText), provenance, negativeText]);
      await query("select public.release_runtime_writer($1,'negative-fixture-seed')", [seeded.lease_id]);
    } finally { await query('reset role'); }
    const negativeBefore = await catalog();
    const negativeLease = negativeBefore.leases.find(row => row.exercise_id === negativeId);
    assert.ok(negativeLease.released_at, 'negative fixture must have no active lease');
    const negativeCheckpoint = negativeBefore.checkpoints.find(row => row.exercise_id === negativeId);
    assert.ok(negativeCheckpoint);
    const negativeBase = Number(negativeCheckpoint.checkpoint_revision);
    assert.equal(negativeBefore.exercises.find(row => row.exercise_id === negativeId).state.exerciseSession.lifecycleState, 'RUNNING');
    await setIdentity(client, cm);
    await query('set role authenticated');
    let denial;
    try {
      const permissions = (await query("select public.has_authorization_permission('CM_WORKFLOW_WRITE',$1) cm,public.has_authorization_permission('EXCON_EXERCISE_CONTROL',$1) excon", [negativeId])).rows[0];
      assert.equal(permissions.cm, true); assert.equal(permissions.excon, false);
      await assert.rejects(() => query("select * from public.acquire_runtime_writer($1,$2,$3,60)",
        [negativeId, `cm-negative-${operation}`, negativeBase]), error => {
        denial = { sqlstate: error.code, message: error.message };
        return error.code === '42501' && error.message === 'AUTHORIZATION_DENIED';
      });
    } finally { await query('reset role'); }
    assert.deepEqual(await catalog(), negativeBefore, 'CM denial changed lease/generation/checkpoint/commands/lifecycle');
    console.log(JSON.stringify({ cmOnlyRejection: { operation, exercise: negativeId, patient: 'PT-001',
      authoritativeRevision: negativeBase, submittedRevision: negativeBase, leaseReleased: true,
      writerGeneration: negativeLease.writer_generation, cmPermission: true, exconPermission: false,
      lifecycle: 'RUNNING', ...denial, allAuthoritativeStateUnchanged: true } }));
    results.push({ name: `native concurrent ${operation}`, status: 'PASS', sqlstate: '00000',
      migrationBackend: blocked.pid, operatorBackend: operatorPid, locks, completedBeforeMigrationCommit,
      ledger: 54, writerGeneration: finalLease.writer_generation,
      checkpointRevision: checkpoint?.checkpoint_revision ?? 0, completionStatus: completion?.status ?? null,
      postCommitCmDenied: true });
    console.log(JSON.stringify(results.at(-1)));
  }
  await migrate();
  const committed = await catalog();
  assert.equal(committed.ledger.length, 54);
  const retry = await migrate();
  assert.deepEqual(await catalog(), committed);
  results.push({ name: 'actual CLI successful commit and ledger-based retry are idempotent', status: 'PASS', stdout: retry.stdout });
  console.log(JSON.stringify({ results, passed: results.length }));
} catch (error) {
  console.error(JSON.stringify({ results, failure: error.message, code: error.code }));
  process.exitCode = 1;
} finally {
  await query('rollback').catch(() => {});
  // Preserve an unexpected injection/failure state as evidence; do not rerun.
  await client.end();
}
