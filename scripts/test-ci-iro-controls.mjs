import assert from 'node:assert/strict';
import {seedCIV3Exercise,verifyCIDeployedHistory} from './ci-deployed-runtime-prerequisites.mjs';
import {registerCIFixtureIdentity} from './ci-historical-protection-baseline.mjs';
export async function qualifyCIIROControls({db,query,pass}){
 const actor='10000000-0000-0000-0000-000000000002',cm='10000000-0000-0000-0000-000000000001',other='10000000-0000-0000-0000-000000000003',admin='10000000-0000-0000-0000-000000000004',id='SYNTHETIC-CI-IRO-RELEASE';
 const identity=user=>query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user??'',JSON.stringify({sub:user,role:'authenticated',is_anonymous:false})]);
 await registerCIFixtureIdentity(query,id);await identity(actor);
 for(const[user,role]of[[actor,'EXCON'],[cm,'CM']])await query("insert into public.authorization_role_assignments(user_id,role,scope_type,scope_id,status,issued_by) values($1,$2,'EXERCISE',$3,'ACTIVE',$1)",[user,role,id]);
 await seedCIV3Exercise(query,id,{exerciseSession:{exerciseId:id,lifecycleState:'RUNNING',simulationTimeSec:182,speed:1,version:1},patients:[{id:'PT-IRO-001',name:'Synthetic'}],exercisePackageReference:{packageId:'russicaptor.narva-iro-evacuation',packageVersion:'1.0.1'}},actor);
 await query('set role authenticated');try{await query('select * from public.ensure_shared_workflow_patient_head($1,$2)',[id,'PT-IRO-001']);}finally{await query('reset role');}
 const snapshot=async()=>JSON.stringify((await query("select jsonb_build_object('commands',(select jsonb_agg(to_jsonb(c) order by command_sequence) from public.runtime_patient_commands c),'heads',(select jsonb_agg(to_jsonb(h) order by exercise_id,patient_id) from public.shared_workflow_patient_states h),'identity',(select to_jsonb(i) from rc_history.identities i where exercise_id=$1)) v",[id])).rows[0].v);
 const submit=(type,payload={},exercise=id)=>query('select * from public.submit_runtime_patient_command($1,$2,$3,$4,0,182,$5)',[exercise,'PT-IRO-001','IRO-CI-COMMAND',type,payload]);
 const tx=async(user,action)=>{const before=await snapshot();await query('begin');try{await identity(user);await query('set local role authenticated');assert.equal((await query('select current_user')).rows[0].current_user,'authenticated');await action();}finally{await query('rollback');assert.equal(await snapshot(),before);}};
 for(const type of ['IRO_CPR_QUALITY_GOOD','IRO_CPR_QUALITY_POOR','IRO_ROSC_ATTEMPT']){
  await pass(type+' scoped EXCON accepted idempotently; writer materialization remains pending',()=>tx(actor,async()=>{const a=(await submit(type)).rows[0],b=(await submit(type)).rows[0];assert.equal(a.status,'APPLIED');assert.equal(b.status,'IDEMPOTENT');assert.equal(a.command_sequence,b.command_sequence);assert.equal((await query('select status from public.runtime_patient_commands where exercise_id=$1 and command_id=$2',[id,'IRO-CI-COMMAND'])).rows[0].status,'ACCEPTED');}));
  for(const[label,user]of[['CM',cm],['wrong-scope EXCON',other],['PLATFORM_ADMIN alone',admin]])await pass(type+' '+label+' denied42501',()=>tx(user,()=>assert.rejects(()=>submit(type),e=>e.code==='42501'&&e.message==='AUTHORIZATION_DENIED')));
  await pass(type+' nonempty payload denied22023',()=>tx(actor,()=>assert.rejects(()=>submit(type,{force:true}),e=>e.code==='22023'&&e.message==='INVALID_RUNTIME_PATIENT_COMMAND')));
  await pass(type+' missing auth denied42501',()=>tx(null,()=>assert.rejects(()=>submit(type),e=>e.code==='42501'&&e.message==='AUTHENTICATION_REQUIRED')));
  await pass(type+' unknown identity denied before missing head',()=>tx(actor,()=>assert.rejects(()=>submit(type,{},'SYNTHETIC-CI-UNKNOWN'),e=>e.code==='42501'&&e.message==='UNKNOWN_IDENTITY_NOT_REGISTERED')));
  await pass(type+' reserved identity denied at entry before payload/auth checks',async()=>{const before=await snapshot();await query('begin');try{await query("update rc_history.identities set state='RESERVED_ID' where exercise_id=$1",[id]);await identity(null);await query('set local role authenticated');await assert.rejects(()=>submit(type,{force:true}),e=>e.code==='42501'&&e.message==='HISTORICAL_ID_RESERVED');}finally{await query('rollback');assert.equal(await snapshot(),before);}});
 }
 await pass('IRO CI probes leave all10 protection functions and19 triggers exact',()=>verifyCIDeployedHistory(db));
}
