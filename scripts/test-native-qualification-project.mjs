import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageQualificationProject,validateQualificationProject,assertLocalConnection,cliEnvironment,localConfig } from './native-qualification-project.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'russicaptor-config-test-'));
const results=[];
const pass=(name,fn)=>{ fn(); results.push({ name,status:'PASS' }); };
const socket='/private/tmp/russicaptor-pg176.TEST/socket';
const connection={ host:socket,port:5432,user:'postgres',database:'russicaptor_m54_qual' };
const server={ version_num:'170006',address:null,database:connection.database };
const originalCwd=process.cwd();
try {
  let project;
  pass('absent source config is not a prerequisite',()=>{ project=stageQualificationProject(root,temp,55); });
  pass('exact local configuration accepted',()=>validateQualificationProject(project));
  const config=path.join(project.directory,'supabase/config.toml');
  pass('missing staged config rejected explicitly',()=>{
    fs.renameSync(config,`${config}.saved`);
    assert.throws(()=>validateQualificationProject(project),/NATIVE_CONFIG_MISSING/);
    fs.renameSync(`${config}.saved`,config);
  });
  pass('invalid and production connection configuration rejected',()=>{
    for(const text of ['invalid','project_id="production"\n[db]\nhost="remote"\n']){
      fs.writeFileSync(config,text); assert.throws(()=>validateQualificationProject(project),/NATIVE_CONFIG_NOT_LOCAL/);
    }
    fs.writeFileSync(config,localConfig);
  });
  pass('wrong cwd safely resolved by explicit source/project paths',()=>{
    process.chdir(temp); validateQualificationProject(project); process.chdir(originalCwd);
  });
  pass('native17.6 private connection accepted',()=>assertLocalConnection(connection,socket,server));
  pass('wrong PostgreSQL version rejected',()=>assert.throws(()=>assertLocalConnection(connection,socket,{...server,version_num:'180006'}),/NATIVE_VERSION_MISMATCH/));
  pass('remote host and TCP server rejected',()=>{
    assert.throws(()=>assertLocalConnection({...connection,host:'remote'},socket,server),/NATIVE_REMOTE_HOST_FORBIDDEN/);
    assert.throws(()=>assertLocalConnection(connection,socket,{...server,address:'127.0.0.1'}),/NATIVE_TCP_FORBIDDEN/);
  });
  pass('wrong database and credentials rejected',()=>{
    assert.throws(()=>assertLocalConnection({...connection,database:'postgres'},socket,server),/NATIVE_DATABASE_MISMATCH/);
    assert.throws(()=>assertLocalConnection({...connection,password:'synthetic'},socket,server),/NATIVE_CREDENTIAL_FORBIDDEN/);
  });
  pass('CLI environment does not inherit credentials or project configuration',()=>{
    assert.deepEqual(cliEnvironment({PATH:'/usr/bin',PGHOST:'remote',SUPABASE_ACCESS_TOKEN:'synthetic',SUPABASE_URL:'remote'}),{PATH:'/usr/bin',LC_ALL:'C',DO_NOT_TRACK:'1'});
  });
  pass('modified staged migration rejected',()=>{
    const file=path.join(project.directory,'supabase/migrations',project.entries[54].file), bytes=fs.readFileSync(file);
    fs.appendFileSync(file,'\n'); assert.throws(()=>validateQualificationProject(project),/NATIVE_STAGED_HASH_MISMATCH/); fs.writeFileSync(file,bytes);
  });
  pass('cleanup remains confined to disposable staging',()=>{
    for(const entry of project.entries) assert.ok(fs.existsSync(path.join(root,'supabase/migrations',entry.file)));
  });
  console.log(JSON.stringify({results,passed:results.length}));
} finally { process.chdir(originalCwd); fs.rmSync(temp,{recursive:true,force:true}); }
