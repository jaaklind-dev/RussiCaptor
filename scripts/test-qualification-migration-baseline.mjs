import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMigrationInventory, migrationBaseline } from './qualification-migration-baseline.mjs';
import { stageQualificationProject, validateQualificationProject } from './native-qualification-project.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-ci-inventory-'));
const source=path.join(temp,'source'),folder=path.join(source,'supabase/migrations');
const results=[];
const pass=(name,fn)=>{fn();results.push({name,status:'PASS'});};
const file=n=>path.join(folder,migrationBaseline.entries[n].file);
function modified(p,action,expected) {
  const bytes=fs.readFileSync(p);
  try { action();assert.throws(()=>verifyMigrationInventory(source),expected); }
  finally {fs.writeFileSync(p,bytes);}
}
try {
  fs.mkdirSync(folder,{recursive:true});
  fs.copyFileSync(path.join(root,'supabase/schema.sql'),path.join(source,'supabase/schema.sql'));
  for(const e of migrationBaseline.entries)fs.copyFileSync(path.join(root,'supabase/migrations',e.file),path.join(folder,e.file));
  pass('exact56 independently pinned files and schema accepted',()=>assert.equal(verifyMigrationInventory(source).length,56));
  let stage;
  pass('native54/55 stage exact verified prefixes without scheduling56',()=>{
    const stage54=stageQualificationProject(source,temp,54);stage=stageQualificationProject(source,temp,55);
    assert.equal(stage54.entries.length,54);assert.equal(stage.entries.length,55);
    validateQualificationProject(stage54);validateQualificationProject(stage);
  });
  pass('missing migration rejected',()=>{
    const p=file(0),saved=path.join(temp,'saved.sql');fs.renameSync(p,saved);
    try{assert.throws(()=>verifyMigrationInventory(source),/NATIVE_MIGRATION_INVENTORY_MISMATCH/);}finally{fs.renameSync(saved,p);}
  });
  pass('unexpected migration rejected',()=>{
    const p=path.join(folder,'20990101000000_unexpected.sql');fs.writeFileSync(p,'select 1;');
    try{assert.throws(()=>verifyMigrationInventory(source),/NATIVE_MIGRATION_INVENTORY_MISMATCH/);}finally{fs.unlinkSync(p);}
  });
  pass('duplicate migration identifier rejected',()=>{
    const p=path.join(folder,migrationBaseline.entries[0].file.split('_')[0]+'_duplicate.sql');fs.writeFileSync(p,'select 1;');
    try{assert.throws(()=>verifyMigrationInventory(source),/NATIVE_DUPLICATE_MIGRATION_ID/);}finally{fs.unlinkSync(p);}
  });
  pass('renamed/reordered54 cannot be staged',()=>{
    const p=file(53),renamed=path.join(folder,'20261025162600_runtime_writer_controller_authorization.sql');fs.renameSync(p,renamed);
    try{assert.throws(()=>verifyMigrationInventory(source),/NATIVE_MIGRATION_INVENTORY_MISMATCH/);}finally{fs.renameSync(renamed,p);}
  });
  for(const n of [53,54,55])pass(`altered protected migration${n+1} rejected`,()=>modified(file(n),()=>fs.appendFileSync(file(n),'\n-- altered\n'),/NATIVE_CANDIDATE_HASH_MISMATCH/));
  pass('altered earlier migration rejected too',()=>modified(file(0),()=>fs.appendFileSync(file(0),'\n-- altered\n'),/NATIVE_CANDIDATE_HASH_MISMATCH/));
  pass('source symlink substitution rejected',()=>{
    const p=file(0),saved=path.join(temp,'original.sql');fs.renameSync(p,saved);fs.symlinkSync(saved,p);
    try{assert.throws(()=>verifyMigrationInventory(source),/NATIVE_SOURCE_SYMLINK_FORBIDDEN/);}finally{fs.unlinkSync(p);fs.renameSync(saved,p);}
  });
  pass('altered foundation schema rejected',()=>modified(path.join(source,'supabase/schema.sql'),()=>fs.appendFileSync(path.join(source,'supabase/schema.sql'),'\n-- altered\n'),/NATIVE_SCHEMA_HASH_MISMATCH/));
  pass('forged staged descriptor cannot bless changed bytes',()=>{
    const forged=structuredClone(stage);forged.entries[53].hash='0'.repeat(64);
    assert.throws(()=>validateQualificationProject(forged),/NATIVE_STAGE_DESCRIPTOR_MISMATCH/);
  });
  pass('same-count substituted migration is not accepted',()=>{
    const p=file(55),renamed=path.join(folder,'20990101000000_substitution.sql');fs.renameSync(p,renamed);
    try{assert.throws(()=>verifyMigrationInventory(source),/NATIVE_MIGRATION_INVENTORY_MISMATCH/);}finally{fs.renameSync(renamed,p);}
  });
  console.log(JSON.stringify({results,passed:results.length}));
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
