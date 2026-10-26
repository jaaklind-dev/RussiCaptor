import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = fs.readFileSync(new URL('../test/fixtures/writer-authorization/historical-protection-v1.json', import.meta.url));
assert.equal(sha(bytes), 'e8842c80319c39c7ddd45bf9669d025fcf4dcbfddede3b57cbc3c3bfcc58d3ca', 'CI_HISTORICAL_BASELINE_CHANGED');
export const historicalBaseline = JSON.parse(bytes);

// Disposable CI scaffolding, not an operational migration. Function bodies and
// trigger definitions below are exact, hash-pinned pre-deployment evidence.
// No historical rows, user identifiers, credentials or production grants enter CI.
export async function installCIHistoricalBaseline(db) {
  await db.exec(`
    create role rc_identity_owner nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
    create schema rc_history authorization rc_identity_owner;
    revoke all on schema rc_history from public,anon,authenticated,service_role;
    grant usage on schema public to rc_identity_owner;
    grant usage on schema rc_history to postgres;
    create table rc_history.identities (
      exercise_id text primary key check(exercise_id=btrim(exercise_id) and length(exercise_id) between 1 and 200),
      state text not null check(state in ('ACTIVE_ID','COMPLETED_ID','RESERVED_ID','ARCHIVED_ID','FORENSIC_ID')),
      binding text check(binding ~ '^[0-9a-f]{64}$'),
      source_digest text check(source_digest ~ '^[0-9a-f]{64}$'),
      created_at timestamptz not null default clock_timestamp()
    );
    alter table rc_history.identities owner to rc_identity_owner;
    alter table rc_history.identities enable row level security;
    alter table rc_history.identities force row level security;
    create policy internal_identity_owner on rc_history.identities to rc_identity_owner using(true) with check(true);
  `);
  for (const f of historicalBaseline.functions) {
    assert.equal(sha(f.definition), f.sha256, 'CI_HISTORICAL_DEFINITION_HASH_MISMATCH');
    await db.exec(f.definition);
    await db.exec(`alter function ${f.signature} owner to ${f.owner};
      revoke all on function ${f.signature} from public,anon,authenticated,service_role;`);
    if (f.signature === 'rc_history.assert_operational_id(text)') {
      await db.exec(`grant execute on function ${f.signature} to postgres;`);
    } else if (f.signature.startsWith('public.trusted_admin_grant_exercise_bootstrap')) {
      await db.exec(`grant execute on function ${f.signature} to service_role;`);
    }
  }
  for (const trigger of historicalBaseline.triggers) await db.exec(`${trigger.definition};`);
  await verifyCIHistoricalBaseline(db);
}

export async function verifyCIHistoricalBaseline(db) {
  const old = (await db.query('show search_path')).rows[0].search_path;
  await db.exec('set search_path=pg_catalog');
  try {
    for (const f of historicalBaseline.functions.filter(f => f.signature.startsWith('rc_history.'))) {
      const actual = (await db.query(`select pg_get_functiondef(p.oid) definition,
        pg_get_userbyid(p.proowner) owner,p.proacl::text acl,p.prosecdef security_definer,p.proconfig config
        from pg_proc p where p.oid=$1::regprocedure`, [f.signature])).rows[0];
      assert.equal(sha(actual.definition), f.sha256, 'CI_HISTORICAL_INSTALLED_DEFINITION_MISMATCH');
      assert.equal(actual.owner, f.owner);
      assert.equal(actual.acl, f.acl);
      assert.equal(actual.security_definer, f.security_definer);
      assert.deepEqual(actual.config, f.config);
    }
    const table=(await db.query(`select pg_get_userbyid(relowner) owner,
      relrowsecurity rls,relforcerowsecurity force_rls from pg_class
      where oid='rc_history.identities'::regclass`)).rows[0];
    assert.deepEqual(table,{owner:historicalBaseline.identityTable.owner,rls:true,force_rls:true});
    const role=(await db.query(`select rolcanlogin login,rolsuper superuser,
      rolcreatedb create_db,rolcreaterole create_role,rolinherit inherit,rolbypassrls bypass_rls
      from pg_roles where rolname='rc_identity_owner'`)).rows[0];
    assert.deepEqual(role,{login:false,superuser:false,create_db:false,create_role:false,inherit:false,bypass_rls:false});
    for (const trigger of historicalBaseline.triggers) {
      const actual = (await db.query(`select pg_get_triggerdef(oid) definition,tgenabled enabled
        from pg_trigger where tgrelid=$1::regclass and tgname=$2`, [trigger.relation,trigger.name])).rows[0];
      assert.deepEqual(actual, {definition:trigger.definition,enabled:trigger.enabled}, 'CI_HISTORICAL_TRIGGER_MISMATCH');
    }
    const rights = (await db.query(`select
      has_schema_privilege('authenticated','rc_history','USAGE') auth_usage,
      has_schema_privilege('anon','rc_history','USAGE') anon_usage,
      has_schema_privilege('service_role','rc_history','USAGE') service_usage,
      has_function_privilege('authenticated','rc_history.assert_operational_id(text)','EXECUTE') auth_execute`)).rows[0];
    assert.deepEqual(rights,{auth_usage:false,anon_usage:false,service_usage:false,auth_execute:false});
  } finally { await db.query("select set_config('search_path',$1,false)",[old]); }
}

export async function registerCIFixtureIdentity(query,id) {
  assert.match(id,/^(?:EX-WRITER-AUTH-\d+(?:-OTHER)?|EX-UNASSIGNED|SYNTHETIC-CI-[A-Z-]+)$/,'CI_SYNTHETIC_ID_REQUIRED');
  await query("insert into rc_history.identities(exercise_id,state) values($1,'ACTIVE_ID')",[id]);
}
