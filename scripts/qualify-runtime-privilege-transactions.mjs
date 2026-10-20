import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { Buffer } from 'node:buffer';
import { privilegeSnapshot, assertPrivilegeOnlyChange } from './qualify-runtime-table-privileges.mjs';
import { assertDbPushDatabaseState } from './qualification-cli-output.mjs';
import { isDeepStrictEqual } from 'node:util';

// Invoked only by the native runner after its private-socket/fresh-DB checks.
// All faults affect the real CLI connection to synthetic PostgreSQL, never the
// migration file. Each rollback is reconciled before the next bounded case.
export async function qualifyPrivilegeTransactions({ query, migrate, socket, version }) {
  const results = [];
  const ledger = async () => (await query('select * from supabase_migrations.schema_migrations order by version')).rows;
  const snapshot = async () => ({ catalog: await privilegeSnapshot(query), ledger: await ledger() });
  assert.equal((await ledger()).length, 54);
  for (const [name, event, condition] of [
    ['before first REVOKE', 'ddl_command_start', 'true'],
    ['between first and second REVOKE', 'ddl_command_end',
      "not has_table_privilege('anon','public.runtime_writer_leases','TRUNCATE') and has_table_privilege('anon','public.runtime_checkpoints','TRUNCATE')"],
  ]) {
    await query(`create function public.m55_fault() returns event_trigger language plpgsql as $$
      begin if tg_tag='REVOKE' and (${condition}) then raise exception 'M55_INJECTED_FAILURE' using errcode='P0001'; end if; end$$;
      create event trigger m55_fault on ${event} execute function public.m55_fault()`);
    const before = await snapshot();
    let error;
    try { await migrate(); } catch (failure) { error = failure; }
    assert.ok(error, `${name}: CLI unexpectedly succeeded`);
    assert.match(`${error.stdout}\n${error.stderr}`, /M55_INJECTED_FAILURE/);
    assert.match(`${error.stdout}\n${error.stderr}`, /P0001/);
    assert.deepEqual(await snapshot(), before);
    results.push({ name, sqlstate: 'P0001', status: 'PASS', rollbackAclDataLedgerVerified: true });
    await query('drop event trigger m55_fault; drop function public.m55_fault()');
  }
  await query(`create function public.m55_ledger_fault() returns trigger language plpgsql as $$
    begin if new.version='${version}' then raise exception 'M55_LEDGER_FAILURE' using errcode='P0001'; end if; return new; end$$;
    create trigger m55_ledger_fault before insert on supabase_migrations.schema_migrations
    for each row execute function public.m55_ledger_fault()`);
  const beforeLedgerFailure = await snapshot();
  let ledgerError;
  try { await migrate(); } catch (error) { ledgerError = error; }
  assert.ok(ledgerError);
  assert.match(`${ledgerError.stdout}\n${ledgerError.stderr}`, /M55_LEDGER_FAILURE/);
  assert.match(`${ledgerError.stdout}\n${ledgerError.stderr}`, /P0001/);
  assert.deepEqual(await snapshot(), beforeLedgerFailure);
  results.push({ name: 'before ledger recording', sqlstate: 'P0001', status: 'PASS', rollbackAclDataLedgerVerified: true });
  await query('drop trigger m55_ledger_fault on supabase_migrations.schema_migrations; drop function public.m55_ledger_fault()');

  await query(`create function public.m55_ledger_gate() returns trigger language plpgsql as $$
    begin if new.version='${version}' then perform pg_advisory_xact_lock(55,55); end if; return new; end$$;
    create trigger m55_ledger_gate before insert on supabase_migrations.schema_migrations
    for each row execute function public.m55_ledger_gate()`);
  const beforeDisconnect = await snapshot();
  await query('select pg_advisory_lock(55,55)');
  const job = migrate().then(value => ({ value }), error => ({ error }));
  let blocked;
  const deadline = Date.now() + 5000;
  while (!blocked && Date.now() < deadline) {
    blocked = (await query("select pid from pg_locks where locktype='advisory' and classid=55 and objid=55 and not granted")).rows[0];
    if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(blocked, 'CLI did not reach the bounded precommit gate');
  assert.equal((await query('select pg_terminate_backend($1) terminated', [blocked.pid])).rows[0].terminated, true);
  const disconnected = await job;
  await query('select pg_advisory_unlock(55,55)');
  assert.ok(disconnected.error);
  assert.match(`${disconnected.error.stdout}\n${disconnected.error.stderr}`, /terminat|57P01/i);
  assert.deepEqual(await snapshot(), beforeDisconnect);
  results.push({ name: 'connection loss before commit', status: 'PASS', rollbackAclDataLedgerVerified: true });
  await query('drop trigger m55_ledger_gate on supabase_migrations.schema_migrations; drop function public.m55_ledger_gate()');

  // Withhold the actual migration batch's final ReadyForQuery(I), after all
  // three REVOKEs and the ledger INSERT have committed. No SQL is rewritten.
  const before = await snapshot();
  const proxyPath = path.join(socket, '.s.PGSQL.5433');
  assert.equal(fs.existsSync(proxyPath), false);
  const connections = new Set(), trace = [], proxyErrors = [];
  let verification, verificationError, dropped = false, candidateCount = 0;
  const proxy = net.createServer(front => {
    const back = net.createConnection({ path: path.join(socket, '.s.PGSQL.5432') });
    connections.add(front); connections.add(back);
    let incoming = Buffer.alloc(0), outgoing = Buffer.alloc(0), startup = true, candidate = false, ledgerSeen = false, sync = false;
    const tags = [];
    front.on('data', chunk => {
      incoming = Buffer.concat([incoming, chunk]);
      while (incoming.length >= (startup ? 4 : 5)) {
        const length = incoming.readUInt32BE(startup ? 0 : 1), size = length + (startup ? 0 : 1);
        assert.ok(length >= 4 && length <= 16 * 1024 * 1024);
        if (incoming.length < size) break;
        const message = incoming.subarray(0, size); incoming = incoming.subarray(size);
        const type = startup ? 'Startup' : String.fromCharCode(message[0]);
        if (type === 'P' || type === 'Q') {
          const offset = type === 'P' ? message.indexOf(0, 5) + 1 : 5;
          const sql = message.subarray(offset, message.indexOf(0, offset)).toString('utf8');
          if (/revoke\s+truncate,\s*trigger\s+on\s+table\s+public\.runtime_writer_leases/i.test(sql)) { candidate = true; candidateCount++; }
          if (candidate && /insert\s+into\s+supabase_migrations\.schema_migrations/i.test(sql)) ledgerSeen = true;
        }
        if (type === 'S' && candidate && ledgerSeen) sync = true;
        startup = false;
      }
      back.write(chunk);
    });
    back.on('data', chunk => {
      outgoing = Buffer.concat([outgoing, chunk]);
      while (outgoing.length >= 5) {
        const length = outgoing.readUInt32BE(1);
        assert.ok(length >= 4 && length <= 16 * 1024 * 1024);
        if (outgoing.length < length + 1) return;
        const message = outgoing.subarray(0, length + 1); outgoing = outgoing.subarray(length + 1);
        const type = String.fromCharCode(message[0]);
        if (candidate && type === 'C') tags.push(message.subarray(5, -1).toString('utf8'));
        assert.ok(trace.length < 512);
        trace.push({ direction: 'server-client', type, bytes: message.length });
        if (candidate && ledgerSeen && sync && type === 'Z') {
          assert.equal(String.fromCharCode(message[5]), 'I');
          assert.deepEqual(tags, ['REVOKE','REVOKE','REVOKE','INSERT 0 1']);
          dropped = true; back.pause();
          verification = (async () => {
            const after = await snapshot();
            assertPrivilegeOnlyChange(before.catalog, after.catalog);
            assert.equal(after.ledger.length, 55);
            assert.deepEqual(after.ledger.slice(0,54), before.ledger);
            assert.equal(after.ledger.at(-1).version, version);
            assert.equal((await query('show fsync')).rows[0].fsync, 'on');
            assert.equal((await query('show synchronous_commit')).rows[0].synchronous_commit, 'on');
          })().catch(error => { verificationError = error; }).finally(() => { front.destroy(); back.destroy(); });
          return;
        }
        front.write(message);
      }
    });
    for (const connection of [front,back]) {
      connection.on('error', error => { if (!dropped) proxyErrors.push(error.code); });
      connection.on('close', () => connections.delete(connection));
    }
    front.on('close', () => back.destroy()); back.on('close', () => front.destroy());
  });
  await new Promise((resolve,reject) => { proxy.once('error',reject); proxy.listen(proxyPath,resolve); });
  let outcome;
  try { outcome = await migrate(undefined,5433).then(value => ({ value }), error => ({ error })); }
  finally { for (const connection of connections) connection.destroy(); await new Promise(resolve => proxy.close(resolve)); }
  if (verification) await verification;
  if (verificationError) throw verificationError;
  assert.equal(dropped,true); assert.equal(candidateCount,1); assert.deepEqual(proxyErrors,[]);
  assert.ok(outcome.error, 'CLI incorrectly reported success after lost commit acknowledgment');
  assert.doesNotMatch(outcome.error.stdout, /Finished supabase db push/);
  assert.match(`${outcome.error.stdout}\n${outcome.error.stderr}`, /connection.*(terminated|lost|closed)/i);
  const committed = await snapshot();
  assert.equal(committed.ledger.length,55);
  const retry = await migrate();
  const parsed = retry.parsed;
  assert.equal(parsed.upToDate,true); assert.deepEqual(parsed.migrations,[]);
  const afterRetry=await snapshot();
  assertDbPushDatabaseState(parsed,{previousLedger:committed.ledger.map(r=>r.version),ledger:afterRetry.ledger.map(r=>r.version),
    expectedLedger:committed.ledger.map(r=>r.version),schemaMatches:isDeepStrictEqual(afterRetry.catalog,committed.catalog)});
  assert.deepEqual(afterRetry,committed);
  results.push({ name: 'committed migration, lost acknowledgment, independent reconciliation then CLI no-op', status: 'PASS', trace,
    batchTags: ['REVOKE','REVOKE','REVOKE','INSERT 0 1'], candidateCount, finalLedger: 55 });
  console.log(JSON.stringify({ migration55Transactions: results, passed: results.length }));
  return results;
}
