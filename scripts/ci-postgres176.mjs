// Local disposable test-cluster lifecycle. Never accepts a database URL.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
const env={PATH:'/usr/bin:/bin',LANG:'C'};
const [mode,arg]=process.argv.slice(2);assert.ok(['start','stop'].includes(mode));assert.equal(process.argv.length,4);
const run=(bin,name,args)=>execFileSync(path.join(bin,name),args,{env,encoding:'utf8',timeout:15000,maxBuffer:2**20});
if(mode==='start'){
 const bin=fs.realpathSync(arg);assert.equal(run(bin,'postgres',['--version']).trim(),'postgres (PostgreSQL) 17.6');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-iro-ci-'));fs.chmodSync(root,0o700);fs.mkdirSync(root+'/socket',{mode:0o700});
 const state={kind:'RC_ISOLATED_CI_PG176',id:randomUUID(),root:fs.realpathSync(root),bin,port:56589,postgresSHA256:createHash('sha256').update(fs.readFileSync(bin+'/postgres')).digest('hex')};
 let started=false;
 try{
  run(bin,'initdb',['-D',state.root+'/data','-U','postgres','--auth-local=trust','--auth-host=reject','--no-locale','-E','UTF8']);
  run(bin,'pg_ctl',['-D',state.root+'/data','-l',state.root+'/server.log','-w','start','-o',`-k ${state.root}/socket -p ${state.port} -c listen_addresses='' -c unix_socket_permissions=0700 -c wal_level=logical -c max_connections=20 -c cluster_name=RussiCaptorCI176`]);started=true;
  fs.writeFileSync(root+'/ci-state.json',JSON.stringify(state,null,2)+'\n',{flag:'wx',mode:0o600});
  if(process.env.GITHUB_ENV)fs.appendFileSync(process.env.GITHUB_ENV,`RUSSICAPTOR_CI_PG176_STATE=${state.root}/ci-state.json\n`);
  console.log(JSON.stringify({stateFile:state.root+'/ci-state.json',postgresVersion:'17.6',tcp:false,retainedSyntheticFiles:true}));
 }catch(e){if(started)run(bin,'pg_ctl',['-D',root+'/data','-m','fast','-w','stop']);throw e;}
}else{
 const file=fs.realpathSync(arg),state=JSON.parse(fs.readFileSync(file));assert.equal(state.kind,'RC_ISOLATED_CI_PG176');assert.equal(path.dirname(file),state.root);assert.match(path.basename(state.root),/^rc-iro-ci-[A-Za-z0-9]+$/);assert.equal(fs.realpathSync(state.root),state.root);
 assert.equal(createHash('sha256').update(fs.readFileSync(state.bin+'/postgres')).digest('hex'),state.postgresSHA256);
 run(state.bin,'pg_ctl',['-D',state.root+'/data','-m','fast','-w','stop']);assert.equal(fs.existsSync(state.root+'/data/postmaster.pid'),false);console.log(JSON.stringify({stopped:true,root:state.root,retainedSyntheticFiles:true}));
}
