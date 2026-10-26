import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { historicalBaseline, registerCIFixtureIdentity, verifyCIHistoricalBaseline } from './ci-historical-protection-baseline.mjs';

// Additional focused checks in the same isolated database as the real writer
// suite. Protected operations execute under actual authenticated/service roles;
// every denial rolls back and compares independent synthetic data fingerprints.
export async function qualifyCIHistoricalProtection({db,query,pass}) {
  const actor='10000000-0000-0000-0000-000000000002';
  const snapshot=async()=>JSON.stringify((await query(`select jsonb_build_object(
    'identities',(select jsonb_agg(to_jsonb(i) order by exercise_id) from rc_history.identities i),
    'bootstrap',(select jsonb_agg(to_jsonb(b) order by id) from public.exercise_bootstrap_authorizations b),
    'commands',(select jsonb_agg(to_jsonb(c) order by command_sequence) from public.runtime_patient_commands c),
    'roles',(select jsonb_agg(to_jsonb(r) order by id) from public.authorization_role_assignments r)
    ) value`)).rows[0].value);
  const denied=async(name,sql,args,reason,role='authenticated')=>pass(name,async()=>{
    const before=await snapshot();let error;
    await query('begin');
    try {
      await query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
        [actor,JSON.stringify({sub:actor,role:'authenticated',is_anonymous:false})]);
      await query(`set local role ${role}`);
      assert.equal((await query('select current_user')).rows[0].current_user,role);
      try { await query(sql,args); } catch(e) { error=e; }
    } finally { await query('rollback'); }
    assert.equal(error?.code,'42501',`${name}: protected operation unexpectedly succeeded or failed for another reason`);
    assert.equal(error?.message,reason);
    assert.equal(await snapshot(),before,'denied historical probe persisted changes');
  });
  await pass('installed historical functions/triggers retain exact hashes and restricted privileges',()=>verifyCIHistoricalBaseline(db));
  const command="select public.record_runtime_patient_command_result($1,0,null,'invalid','MATERIALIZED','{}')";
  for(const state of ['COMPLETED_ID','RESERVED_ID','FORENSIC_ID','ARCHIVED_ID']) {
    const id=`SYNTHETIC-CI-${state.replace('_ID','')}`;
    await registerCIFixtureIdentity(query,id);
    await query('update rc_history.identities set state=$2 where exercise_id=$1',[id,state]);
    await denied(`${state} denied at migration54 command entry before lease validation`,command,[id],'HISTORICAL_ID_RESERVED');
    await denied(`${state} denied by real historical runtime trigger`,
      `insert into public.authorization_role_assignments(user_id,role,scope_type,scope_id,status,issued_by)
       values($1,'CM','EXERCISE',$2,'ACTIVE',$1)`,[actor,id],'HISTORICAL_ID_RESERVED','service_role');
  }
  await denied('unregistered identity is not silently treated as operational',command,['SYNTHETIC-CI-UNKNOWN'],'UNKNOWN_IDENTITY_NOT_REGISTERED');
  await denied('private historical guard is not a newly exposed authenticated helper',
    "select rc_history.assert_operational_id($1)",['SYNTHETIC-CI-RESERVED'],'permission denied for schema rc_history');
  await pass('identity immutability is real and preserves reserved rows',async()=>{
    const before=await snapshot();let error;
    await query('begin');try{await query("delete from rc_history.identities where exercise_id='SYNTHETIC-CI-RESERVED'");}catch(e){error=e;}finally{await query('rollback');}
    assert.equal(error?.code,'42501');assert.equal(error?.message,'IDENTITY_IMMUTABLE');assert.equal(await snapshot(),before);
  });
  await pass('guard metadata substitution fails closed',async()=>{
    await query('begin');
    try {
      await query('alter function rc_history.guard_runtime() set search_path=public');
      await assert.rejects(()=>verifyCIHistoricalBaseline(db),/CI_HISTORICAL_INSTALLED_DEFINITION_MISMATCH/);
    } finally { await query('rollback'); }
    await verifyCIHistoricalBaseline(db);
  });
  await pass('bootstrap migration retains exact guard source-CAS prerequisite',async()=>{
    const old=(await query('show search_path')).rows[0].search_path;
    await query('set search_path=pg_catalog');
    try {
      const actual=(await query("select pg_get_functiondef('rc_history.guard_runtime()'::regprocedure) definition")).rows[0].definition;
      assert.equal(createHash('sha256').update(actual).digest('hex'),historicalBaseline.functions.find(f=>f.signature==='rc_history.guard_runtime()').sha256);
    }finally{await query("select set_config('search_path',$1,false)",[old]);}
  });
  await pass('legitimate fresh bootstrap preserves expired consumed historical row after56',async()=>{
    const id='SYNTHETIC-CI-BOOTSTRAP';
    await registerCIFixtureIdentity(query,id);
    await query(`insert into public.exercise_bootstrap_authorizations(user_id,status,purpose,issued_at,expires_at,issued_by,consumed_exercise_id,consumed_at)
      values($1,'ACTIVE','SYNTHETIC-CI-HISTORY',now()-interval '1 day',now()-interval '23 hours',$1,$2,now()-interval '1 day')`,[actor,id]);
    await query("update rc_history.identities set state='COMPLETED_ID' where exercise_id=$1",[id]);
    const before=JSON.stringify((await query('select to_jsonb(b) value from public.exercise_bootstrap_authorizations b where consumed_exercise_id=$1',[id])).rows);
    await query('begin');
    try{
      await query('set local role service_role');
      const result=(await query("select * from public.trusted_admin_grant_exercise_bootstrap($1,$1,now()+interval '10 minutes','SYNTHETIC-CI-FRESH')",[actor])).rows[0];
      assert.equal(result.status,'ACTIVE');assert.equal(result.consumed_exercise_id,null);
    }finally{await query('rollback');}
    assert.equal(JSON.stringify((await query('select to_jsonb(b) value from public.exercise_bootstrap_authorizations b where consumed_exercise_id=$1',[id])).rows),before);
  });
}
