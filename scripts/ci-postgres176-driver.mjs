import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash,randomBytes} from 'node:crypto';
export async function createCI176Database(){
 const file=process.env.RUSSICAPTOR_CI_PG176_STATE;assert.ok(file,'CI_PG176_REQUIRED: start scripts/ci-postgres176.mjs with a verified PostgreSQL17.6 bin directory; PGlite18 cannot execute the unchanged PG17 catalog contract');
 const state=JSON.parse(fs.readFileSync(fs.realpathSync(file)));
 assert.equal(state.kind,'RC_ISOLATED_CI_PG176');assert.equal(fs.realpathSync(state.root),state.root);assert.equal(path.dirname(fs.realpathSync(file)),state.root);assert.match(path.basename(state.root),/^rc-iro-ci-[A-Za-z0-9]+$/);
 assert.equal(fs.statSync(state.root).mode&0o077,0);assert.equal(fs.statSync(state.root+'/socket').mode&0o077,0);
 assert.equal(createHash('sha256').update(fs.readFileSync(state.bin+'/postgres')).digest('hex'),state.postgresSHA256);
 const require=createRequire(new URL('./ci-pg-driver/package.json',import.meta.url));const {Client,types}=require('pg');types.setTypeParser(20,Number);
 const config={host:state.root+'/socket',port:state.port,user:'postgres',database:'postgres',password:'',ssl:false,connectionTimeoutMillis:3000,query_timeout:15000};
 const control=new Client(config);await control.connect();let client,created=false;
 const database='rc_ci_'+randomBytes(10).toString('hex');assert.match(database,/^rc_ci_[a-f0-9]{20}$/);
 try{
  const server=(await control.query("select current_setting('server_version_num') version,current_setting('listen_addresses') listen,inet_server_addr() ip,current_setting('data_directory') data,current_setting('cluster_name') cluster")).rows[0];
  server.data=fs.realpathSync(server.data);
  assert.deepEqual(server,{version:'170006',listen:'',ip:null,data:state.root+'/data',cluster:'RussiCaptorCI176'});
  // Global fixture roles cannot be shared across concurrent disposable DBs.
  // Serialize on the control database and clean only this known CI owner role;
  // DROP without CASCADE fails if any unexpected dependency remains.
  await control.query("select pg_advisory_lock(hashtextextended('RussiCaptor:isolated-CI-fixtures',0))");
  await control.query('drop role if exists rc_identity_owner');
  for(const role of ['anon','authenticated','service_role']){
   const old=(await control.query('select rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolbypassrls from pg_roles where rolname=$1',[role])).rows[0];
   const expected={rolcanlogin:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolinherit:true,rolbypassrls:role==='service_role'};
   if(old)assert.deepEqual(old,expected);else await control.query('create role '+role+' nologin '+(role==='service_role'?'bypassrls':''));
  }
  await control.query('create database "'+database+'"');created=true;
  client=new Client({...config,database});await client.connect();await client.query("set timezone='UTC';set statement_timeout='10s';set idle_in_transaction_session_timeout='15s'");
  return {query:(text,args=[])=>client.query(text,args),exec:text=>client.query(text),async close(){try{await client.end();await control.query('drop database "'+database+'"');await control.query('drop role if exists rc_identity_owner');}finally{await control.end();}}};
 }catch(e){await client?.end().catch(()=>{});if(created)await control.query('drop database "'+database+'"').catch(()=>{});await control.end();throw e;}
}
