import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const protectedTables = ['exercise_states', 'runtime_checkpoints', 'runtime_writer_leases'];
const ident = name => `public."${name}"`;
export async function privilegeSnapshot(query) {
  const tables = (await query(`select c.relname,pg_get_userbyid(c.relowner) owner,c.relrowsecurity,c.relforcerowsecurity,
    c.relkind,c.relacl::text acl from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') order by c.relname`)).rows;
  const grants = (await query(`select c.relname,pg_get_userbyid(a.grantor) grantor,
    case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end grantee,a.privilege_type,a.is_grantable
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    where n.nspname='public' and c.relkind in ('r','p') order by 1,2,3,4,5`)).rows;
  const invariant = (await query(`select jsonb_build_object(
    'functions',(select jsonb_agg(jsonb_build_object('id',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),
      'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
    'triggers',(select jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,
      'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.tgrelid::regclass::text,t.tgname)
      from pg_trigger t where not t.tgisinternal),
    'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p),
    'defaults',(select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d),
    'memberships',(select jsonb_agg(to_jsonb(m) order by roleid,member) from pg_auth_members m),
    'roles',(select jsonb_agg(jsonb_build_object('name',rolname,'login',rolcanlogin,'inherit',rolinherit,
      'super',rolsuper,'bypassrls',rolbypassrls) order by rolname) from pg_roles)
  ) value`)).rows[0].value;
  const data = [];
  for (const table of tables) {
    assert.match(table.relname, /^[a-z_]+$/);
    const value = (await query(`select count(*)::int count,coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) value from ${ident(table.relname)} t`)).rows[0];
    data.push({ table: table.relname, count: value.count,
      sha256: createHash('sha256').update(JSON.stringify(value.value)).digest('hex') });
  }
  return { tables, grants, invariant, data };
}

export function assertPrivilegeOnlyChange(before, after) {
  assert.deepEqual(after.invariant, before.invariant, 'function/trigger/RLS/default/role contract changed');
  assert.deepEqual(after.data, before.data, 'migration changed runtime or clinical data');
  assert.deepEqual(after.tables.map(t => ({ ...t, acl: null })), before.tables.map(t => ({ ...t, acl: null })));
  const removed = g => protectedTables.includes(g.relname) && ['PUBLIC','anon','authenticated'].includes(g.grantee)
    && ['TRUNCATE','TRIGGER'].includes(g.privilege_type);
  assert.equal(before.grants.filter(removed).length, 12, 'historical six table/role pairs each have two excess grants');
  assert.deepEqual(after.grants, before.grants.filter(g => !removed(g)), 'unexpected ACL delta');
}

// Actual SQL under SET LOCAL ROLE, never a catalog-only substitute. Every probe
// is rolled back and all public data fingerprints are checked independently.
export async function qualifyRuntimeTablePrivileges({ query, setCmIdentity }) {
  const baseline = await privilegeSnapshot(query);
  assert.equal((await query(`select count(*)::int n from pg_auth_members m join pg_roles r on r.oid=m.member
    where r.rolname in ('anon','authenticated')`)).rows[0].n, 0, 'unexpected inherited role authority');
  const publicGrants = baseline.grants.filter(g => protectedTables.includes(g.relname) && g.grantee==='PUBLIC'
    && ['TRUNCATE','TRIGGER'].includes(g.privilege_type));
  assert.deepEqual(publicGrants, []);
  // query() is a single prepared statement in PGlite. Keep one statement per
  // call; role/timeout setup below stays inside the same explicit transaction.
  await query('create function public.m55_harmless_probe() returns trigger language plpgsql as $$begin return null; end$$');
  await query(`create trigger m55_harmless_probe after truncate on public.exercise_states
    for each statement execute function public.m55_harmless_probe()`);
  const probes = [];
  try {
    for (const role of ['anon','authenticated']) {
      for (const table of protectedTables) {
        const rights = (await query(`select has_table_privilege($1,$2,'TRUNCATE') truncate,
          has_table_privilege($1,$2,'TRIGGER') trigger,has_function_privilege($1,'public.m55_harmless_probe()','EXECUTE') execute`, [role, `public.${table}`])).rows[0];
        assert.deepEqual(rights, { truncate: false, trigger: false, execute: true });
      }
      const operations = protectedTables.flatMap(table => [
        [`single ${table}`, `truncate ${ident(table)}`],
        [`cascade ${table}`, `truncate ${ident(table)} cascade`],
        [`create trigger ${table}`, `create trigger m55_new_probe after truncate on ${ident(table)} for each statement execute function public.m55_harmless_probe()`],
        [`replace trigger ${table}`, `create or replace trigger m55_harmless_probe after truncate on ${ident(table)} for each statement execute function public.m55_harmless_probe()`],
        [`disable trigger ${table}`, `alter table ${ident(table)} disable trigger all`],
      ]);
      operations.push(['multi table', `truncate ${protectedTables.map(ident).join(',')} cascade`]);
      for (const [name, sql] of operations) {
        const before = await privilegeSnapshot(query);
        let error;
        await query('begin');
        try {
          await setCmIdentity();
          await query(`set local role ${role}`);
          await query("set local lock_timeout='2s'");
          await query("set local statement_timeout='5s'");
          assert.equal((await query('select current_user')).rows[0].current_user, role);
          try { await query(sql); } catch (failure) { error = failure; }
        } finally { await query('rollback'); }
        assert.equal(error?.code, '42501', `${role} ${name}: expected privilege denial, got ${error?.message ?? 'accepted'}`);
        assert.deepEqual(await privilegeSnapshot(query), before, 'denied SQL changed authoritative state');
        probes.push({ role, name, sqlstate: error.code, message: error.message, accepted: false, dataAndCatalogPreserved: true });
      }
    }
  } finally {
    await query('drop trigger m55_harmless_probe on public.exercise_states');
    await query('drop function public.m55_harmless_probe()');
  }
  assert.deepEqual(await privilegeSnapshot(query), baseline);
  console.log(JSON.stringify({ migration55PrivilegeProbes: probes, passed: probes.length,
    publicAndInheritedPrivilegePathsAbsent: true, externalApiReachability: 'NOT_VERIFIED' }));
  return probes;
}
