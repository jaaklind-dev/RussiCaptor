import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Called only after the native runner has verified its fresh private cluster.
// No connection URL, production credentials or external side effects here.
export async function qualifyHistoricalPrivileges({ query, setCmIdentity }) {
  const targets = ['runtime_writer_leases', 'runtime_checkpoints', 'exercise_states'];
  const roles = ['anon', 'authenticated'];
  const ident = value => { assert.match(value, /^[a-z_][a-z0-9_]*$/); return `public.${value}`; };
  const edges = (await query(`select confrelid::regclass::text parent,conrelid::regclass::text child,
    pg_get_constraintdef(oid) definition from pg_constraint where contype='f' order by 1,2,3`)).rows;
  const inheritance = (await query(`select inhparent::regclass::text parent,inhrelid::regclass::text child
    from pg_inherits order by 1,2`)).rows;
  const closure = names => {
    const found = new Set(names);
    for (let changed = true; changed;) {
      changed = false;
      for (const { parent, child } of [...edges, ...inheritance]) {
        if (found.has(parent) && !found.has(child)) { found.add(child); changed = true; }
      }
    }
    return [...found].sort();
  };
  const related = closure(targets);
  assert.deepEqual(related, ['exercise_states', 'runtime_checkpoint_canonical_artifacts',
    'runtime_checkpoint_deltas', 'runtime_checkpoint_notifications', 'runtime_checkpoints', 'runtime_writer_leases']);
  const tableCatalog = (await query(`select c.relname table_name,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
    c.relispartition is_partition,c.relacl::text acl,pg_get_userbyid(c.relowner) owner,
    (select jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(t.oid),'enabled',tgenabled))
      from pg_trigger t where t.tgrelid=c.oid and not tgisinternal) triggers
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1::text[]) order by c.relname`, [related])).rows;
  const roleCatalog = (await query(`select r.rolname,r.rolcanlogin,r.rolsuper,r.rolbypassrls,r.rolinherit,
    (select jsonb_agg(x.rolname) from pg_roles x where x.oid<>r.oid and pg_has_role(r.oid,x.oid,'USAGE')) inherited
    from pg_roles r where rolname=any($1::text[]) order by rolname`, [roles])).rows;
  const grants = (await query(`select r.rolname,t.table_name,
    has_table_privilege(r.rolname,'public.'||t.table_name,'TRUNCATE') can_truncate,
    has_table_privilege(r.rolname,'public.'||t.table_name,'TRIGGER') can_trigger,
    has_schema_privilege(r.rolname,'public','CREATE') schema_create,
    has_schema_privilege(r.rolname,'public','USAGE') schema_usage
    from pg_roles r cross join unnest($1::text[]) t(table_name)
    where r.rolname=any($2::text[]) order by r.rolname,t.table_name`, [related, roles])).rows;
  console.log(JSON.stringify({ privilegeGraph: { tables: tableCatalog,
    edges: edges.filter(e => related.includes(e.parent) || related.includes(e.child)),
    direction: 'referenced parent -> referencing child; CASCADE follows this direction',
    cascadeClosure: related, inheritance: inheritance.filter(e => related.includes(e.parent) || related.includes(e.child)),
    roles: roleCatalog, grants } }));
  assert.equal(tableCatalog.length, 6);
  assert.equal(inheritance.filter(e => related.includes(e.parent) || related.includes(e.child)).length, 0);
  for (const table of tableCatalog) assert.equal(table.is_partition, false);
  for (const role of roleCatalog) {
    assert.equal(role.rolcanlogin, false); assert.equal(role.rolsuper, false);
    assert.equal(role.rolbypassrls, false); assert.equal(role.inherited, null);
  }
  for (const grant of grants) {
    assert.equal(grant.can_truncate, targets.includes(grant.table_name));
    assert.equal(grant.can_trigger, targets.includes(grant.table_name));
    assert.equal(grant.schema_create, false); assert.equal(grant.schema_usage, true);
  }
  const names = (await query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(r => r.tablename);
  const fingerprint = async () => {
    const values = [];
    for (const table of names) values.push({ table, ...(await query(`select count(*)::int n,
      md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) hash from ${ident(table)} t`)).rows[0] });
    return values;
  };
  const originalRows = await fingerprint();
  const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  const probes = [];
  async function probe({ role, label, sql, expected, affected = [], observe }) {
    let actual = '00000'; let message = null; let changedTables = []; let observation;
    await setCmIdentity();
    await query('begin');
    try {
      if (role !== 'postgres') await query(`set local role ${role}`);
      await query("set local lock_timeout='2s'; set local statement_timeout='5s'");
      try {
        await query(sql);
        if (observe) observation = await observe();
        await query('reset role');
        const during = await fingerprint();
        changedTables = during.filter((r, i) => r.hash !== originalRows[i].hash).map(r => r.table);
        if (affected.length) for (const table of affected) assert.equal(during.find(r => r.table === table)?.n, 0);
      } catch (error) {
        if (!/^[0-9A-Z]{5}$/.test(error.code ?? '')) throw error;
        actual = error.code; message = error.message;
      }
    } finally { await query('rollback'); }
    const restored = await fingerprint();
    const result = { role, label, expectedSqlstate: expected, sqlstate: actual,
      accepted: actual === '00000', message, affectedScope: actual === '00000' ? affected : [],
      changedTables, observation, rollbackSha256: digest(restored), rollbackRestoredAllPublicRows: true };
    console.log(JSON.stringify({ privilegeProbe: result }));
    assert.deepEqual(restored, originalRows, `${label}: rollback did not restore all public rows`);
    assert.equal(actual, expected, `${role}/${label}: unexpected SQLSTATE`);
    probes.push(result);
  }
  // Expected outcomes were established from the inspected graph, not inferred
  // from one failed CASCADE attempt. No child grants are added for these probes.
  for (const role of roles) {
    for (const table of targets) for (const cascade of [false, true]) {
      await probe({ role, label: `single ${table} ${cascade ? 'CASCADE' : 'RESTRICT'}`,
        sql: `truncate ${ident(table)} ${cascade ? 'cascade' : 'restrict'}`,
        expected: table === 'runtime_checkpoints' ? cascade ? '42501' : '0A000' : '00000',
        affected: closure([table]) });
    }
    for (const cascade of [false, true]) {
      await probe({ role, label: `multi parents ${cascade ? 'CASCADE' : 'RESTRICT'}`,
        sql: `truncate ${targets.map(ident).join(',')} ${cascade ? 'cascade' : 'restrict'}`,
        expected: cascade ? '42501' : '0A000', affected: related });
      await probe({ role, label: `multi independent ${cascade ? 'CASCADE' : 'RESTRICT'}`,
        sql: `truncate public.runtime_writer_leases,public.exercise_states ${cascade ? 'cascade' : 'restrict'}`,
        expected: '00000', affected: ['runtime_writer_leases', 'exercise_states'] });
    }
    await probe({ role, label: 'complete FK closure explicitly listed',
      sql: `truncate ${related.map(ident).join(',')} restrict`, expected: '42501', affected: related });
  }
  // Owner controls distinguish FK semantics from untrusted-role permission.
  await probe({ role: 'postgres', label: 'owner checkpoint CASCADE control',
    sql: 'truncate public.runtime_checkpoints cascade', expected: '00000', affected: closure(['runtime_checkpoints']) });
  await probe({ role: 'postgres', label: 'owner explicit closure control',
    sql: `truncate ${related.map(ident).join(',')} restrict`, expected: '00000', affected: related });

  // Harmless disposable functions. The first keeps PostgreSQL's default PUBLIC
  // EXECUTE; the second explicitly removes it, to test the independent check.
  await query(`create function public.m54_privilege_probe() returns trigger language plpgsql as $$
    begin perform set_config('m54.harmless_trigger_seen','yes',true); return null; end$$;
    create function public.m54_privilege_noexecute() returns trigger language plpgsql as $$begin return null; end$$;
    revoke all on function public.m54_privilege_noexecute() from public,anon,authenticated;`);
  for (const role of roles) {
    assert.equal((await query("select has_function_privilege($1,'public.m54_privilege_probe()','EXECUTE') yes", [role])).rows[0].yes, true);
    assert.equal((await query("select has_function_privilege($1,'public.m54_privilege_noexecute()','EXECUTE') yes", [role])).rows[0].yes, false);
    for (const table of targets) {
      await probe({ role, label: `create/replace harmless trigger ${table}`,
        sql: `create trigger m54_privilege_probe after truncate on ${ident(table)} for each statement execute function public.m54_privilege_probe();
          create or replace trigger m54_privilege_probe after truncate on ${ident(table)} for each statement execute function public.m54_privilege_probe()`,
        expected: '00000' });
      await probe({ role, label: `trigger function EXECUTE denied ${table}`,
        sql: `create trigger m54_privilege_probe after truncate on ${ident(table)} for each statement execute function public.m54_privilege_noexecute()`, expected: '42501' });
      await probe({ role, label: `alter table trigger requires ownership ${table}`,
        sql: `create trigger m54_privilege_probe after truncate on ${ident(table)} for each statement execute function public.m54_privilege_probe();
          alter table ${ident(table)} disable trigger m54_privilege_probe`, expected: '42501' });
    }
    await probe({ role, label: 'schema CREATE required for new function',
      sql: 'create function public.m54_untrusted_probe() returns integer language sql as $$select 1$$', expected: '42501' });
    await probe({ role, label: 'harmless statement trigger actually fires', expected: '00000', affected: ['runtime_writer_leases'],
      sql: `create trigger m54_privilege_probe after truncate on public.runtime_writer_leases for each statement execute function public.m54_privilege_probe();
        truncate public.runtime_writer_leases`,
      observe: async () => {
        const seen = (await query("select current_setting('m54.harmless_trigger_seen',true) seen")).rows[0].seen;
        assert.equal(seen, 'yes'); return { harmlessTriggerSeen: true };
      } });
  }
  assert.equal((await query("select count(*)::int n from pg_trigger where tgname='m54_privilege_probe'")).rows[0].n, 0);
  // Independent local revocation compatibility experiment. Not migration54.
  for (const table of targets) await query(`revoke truncate,trigger on ${ident(table)} from anon,authenticated`);
  for (const role of roles) for (const table of targets) {
    await probe({ role, label: `post-revoke TRUNCATE ${table}`, sql: `truncate ${ident(table)} cascade`, expected: '42501' });
    await probe({ role, label: `post-revoke TRIGGER ${table}`,
      sql: `create trigger m54_privilege_probe after truncate on ${ident(table)} for each statement execute function public.m54_privilege_probe()`, expected: '42501' });
  }
  await query('drop function public.m54_privilege_probe(); drop function public.m54_privilege_noexecute()');
  const exposedFunctions = (await query(`select p.proname,pg_get_function_identity_arguments(p.oid) arguments,
    p.prosecdef security_definer,pg_get_userbyid(p.proowner) owner,
    has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
    md5(pg_get_functiondef(p.oid)) definition_hash,
    pg_get_functiondef(p.oid) ~* '\\mtruncate\\M|create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?trigger|execute[[:space:]]+(format|p_|sql|query)' review_candidate
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' order by p.proname,arguments`)).rows;
  console.log(JSON.stringify({ localRpcInventory: exposedFunctions, externalReachability: 'NOT_VERIFIED',
    note: 'No live API attack; absence of an obvious destructive RPC is not proof of universal unreachability.' }));
  console.log(JSON.stringify({ privilegeQualification: 'PASS', probes: probes.length,
    truncateAccepted: probes.filter(p => /^(single|multi|owner|complete)/.test(p.label) && p.accepted).length,
    allRollbacksVerified: true, localUnusedPrivilegesRevoked: true,
    normalAuthorizationMatrixRunsAfterRevocation: true, productionPrivilegesChanged: false }));
}
