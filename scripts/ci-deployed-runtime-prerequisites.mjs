// Synthetic CI baseline only. Never apply this file to an operational database.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=fs.readFileSync(new URL('../test/fixtures/writer-authorization/deployed-prerequisites-v3.json',import.meta.url));
assert.equal(sha(bytes),'8f9443881dde4baf7e11e70a473e151919d50f82a5b0a667da2f5bedaab140a9','CI_DEPLOYED_PREREQUISITE_IDENTITY_MISMATCH');
export const deployedPrerequisites=JSON.parse(bytes);
const snapshot=fs.readFileSync(new URL('../test/fixtures/writer-authorization/historical-protection-v3-snapshot.sql',import.meta.url),'utf8');
assert.equal(sha(snapshot),'6f5d31db85793f9a85dd72c5b7dc3d5781827308ced56a84a0d8d92886979fda');
export async function installCIDeployedRuntimePrerequisites(db){
 await db.exec(`create table rc_history.allocations(actor_user_id uuid not null,request_id uuid not null,bootstrap_id uuid not null,purpose text not null,exercise_id text not null,created_at timestamptz not null default clock_timestamp());`);
 for(const c of deployedPrerequisites.allocation.constraints.filter(c=>c.relation==='rc_history.allocations'))await db.exec('alter table rc_history.allocations add constraint "'+c.name+'" '+c.definition);
 await db.exec(`alter table rc_history.allocations owner to rc_identity_owner;alter table rc_history.allocations enable row level security;alter table rc_history.allocations force row level security;revoke all on rc_history.allocations from public,anon,authenticated,service_role;
 create policy allocation_internal on rc_history.allocations to rc_identity_owner using(true) with check(true);
 grant select(user_id,status) on public.operator_profiles to rc_identity_owner;grant select on public.exercise_bootstrap_authorizations to rc_identity_owner;
 create policy rc_identity_profile_read on public.operator_profiles for select to rc_identity_owner using(true);
 create policy rc_identity_bootstrap_read on public.exercise_bootstrap_authorizations for select to rc_identity_owner using(true);`);
 for(const f of deployedPrerequisites.allocation.functions){await db.exec(f.definition);await db.exec('alter function '+f.signature+' owner to '+f.owner+';revoke all on function '+f.signature+' from public,anon,authenticated,service_role;');if(f.signature==='rc_history.assert_operational_id(text)')await db.exec('grant execute on function '+f.signature+' to postgres');}
 for(const name of ['a1_allocation_claim','allocation_immutable']){const t=deployedPrerequisites.allocation.triggers.find(t=>t.name===name);assert(t);await db.exec(t.definition+';');}
 // Definitions are independently pinned by the complete fixture hash above.
 for(const f of deployedPrerequisites.publication){const signature=f.identity.startsWith('public.')?f.identity:'public.'+f.identity;await db.exec(f.definition+';');await db.exec('revoke all on function '+signature+' from public,anon,authenticated,service_role');if(f.acl.includes('authenticated=X/postgres'))await db.exec('grant execute on function '+signature+' to authenticated');if(f.acl.includes('service_role=X/postgres'))await db.exec('grant execute on function '+signature+' to service_role');}
 const f=deployedPrerequisites.submitBefore;assert.equal(sha(f.definition),f.sha256);await db.exec(f.definition+';');await db.exec('grant execute on function '+f.signature+' to service_role');
 const previous=(await db.query('show search_path')).rows[0].search_path;await db.query('set search_path=pg_catalog');
 try{for(const f of deployedPrerequisites.allocation.functions){const actual=(await db.query('select pg_get_functiondef(oid) definition,pg_get_userbyid(proowner) owner,proacl::text acl,prosecdef security_definer,proconfig config from pg_proc where oid=$1::regprocedure',[f.signature])).rows[0];assert.deepEqual(actual,{definition:f.definition,owner:f.owner,acl:f.acl,security_definer:f.security_definer,config:f.config},'CI_ALLOCATION_PREREQUISITE_NOT_EXACT');}
 assert.equal((await db.query('select pg_get_functiondef($1::regprocedure) definition',[f.signature])).rows[0].definition,f.definition);
 }finally{await db.query("select set_config('search_path',$1,false)",[previous]);}
}
export async function verifyCIDeployedHistory(db){const previous=(await db.query('show search_path')).rows[0].search_path;try{await db.query('set search_path=pg_catalog');const actual=(await db.query(snapshot)).rows[0].snapshot;assert.deepEqual(actual,deployedPrerequisites.historyAfter,'CI_HISTORICAL_V3_MISMATCH');return {functions:actual.functions.length,triggers:actual.triggers.length};}finally{await db.query("select set_config('search_path',$1,false)",[previous]);}}
export async function seedCIV3Exercise(query,id,state,actor){
 assert.match(id,/^(?:EX-WRITER-AUTH-\d+|SYNTHETIC-CI-[A-Z-]+)$/,'CI_SYNTHETIC_ID_REQUIRED');
 const bootstrap=randomUUID();
 await query("insert into public.exercise_bootstrap_authorizations(id,user_id,purpose,issued_at,expires_at,issued_by) values($1,$2,'Synthetic deployed-baseline fixture',clock_timestamp(),clock_timestamp()+interval '10 minutes',$2)",[bootstrap,actor]);
 await query("insert into rc_history.allocations(actor_user_id,request_id,bootstrap_id,purpose,exercise_id) values($1,$2,$3,'TEST',$4)",[actor,randomUUID(),bootstrap,id]);
 const ready=structuredClone(state);ready.exerciseSession={...ready.exerciseSession,lifecycleState:'READY',simulationTimeSec:0,speed:1,lastCommandId:'PREPARE-SYNTHETIC-CI'};
 await query('insert into public.exercise_states(exercise_id,revision,state,updated_by) values($1,1,$2,$3)',[id,ready,actor]);
 await query('update public.exercise_states set state=$2 where exercise_id=$1',[id,state]);
}
