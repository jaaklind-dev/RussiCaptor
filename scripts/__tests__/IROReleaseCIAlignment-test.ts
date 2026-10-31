import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=process.cwd();
const files=[
 ['20261028195410_decouple_runtime_checkpoint_delta_retention.sql','be89191b16a3abbf4d26f58e83c603aabfda5a370a636886e1bbd0200fcc8abc'],
 ['20261028203905_bounded_checkpoint_delta_retention.sql','d0429be0356d6f71c13e1fea72f340e27188d92e76105f02ae0cea881bea1842'],
 ['20261031155028_iro_resuscitation_controls.sql','f6add2c749dd2323edd300f3e03af2831102ddad69608f938f52cb6f36e25a2e'],
];
const release=JSON.parse(fs.readFileSync(path.join(root,'release/field-release.json'),'utf8'));
const invoke=(expression:string)=>spawnSync(process.execPath,['--input-type=module','-e',`import {productionCompatibility} from './scripts/field-release-policy.mjs';const required=${JSON.stringify(release.requiredSupabaseMigrations.map((x:{remoteVersion:string})=>x.remoteVersion))};console.log(JSON.stringify(${expression}));`],{cwd:root,encoding:'utf8'});
describe('IRO deployed migration release/CI linkage',()=>{
 test.each(files)('exact deployed bytes and release prerequisite %s',(file,hash)=>{
  expect(createHash('sha256').update(fs.readFileSync(path.join(root,'supabase/migrations',file))).digest('hex')).toBe(hash);
  expect(release.requiredSupabaseMigrations.find((x:{remoteVersion:string})=>x.remoteVersion===file.split('_')[0])).toEqual({remoteVersion:file.split('_')[0],localFile:file,sha256:hash});
 });
 test.each(files)('absence of %s blocks future compatibility',(file)=>{const r=invoke(`productionCompatibility(required,{RUSSICAPTOR_MIGRATION_PROJECT_REF:'fimcsrivizpliiuoqopv',RUSSICAPTOR_DEPLOYED_MIGRATIONS:required.filter(v=>v!=='${file.split('_')[0]}').join(',')})`);expect(r.status).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({status:'BLOCKED',missingRequiredMigrations:[file.split('_')[0]]});});
 test('complete synthetic ledger is compatible but is not deployment or release proof',()=>{const r=invoke("productionCompatibility(required,{RUSSICAPTOR_MIGRATION_PROJECT_REF:'fimcsrivizpliiuoqopv',RUSSICAPTOR_DEPLOYED_MIGRATIONS:required.join(',')})");expect(r.status).toBe(0);expect(JSON.parse(r.stdout).status).toBe('PASS');});
 test('historical56 inventory remains byte-identical',()=>expect(createHash('sha256').update(fs.readFileSync(path.join(root,'test/fixtures/writer-authorization/migration-baseline-v2.json'))).digest('hex')).toBe('1e14a7dff431b08d963369df28fe0e12c698d56d14f307255b6e3cc0d31b7166'));
 test('CI uses native17.6 without silently normalizing PG18 catalog or deployed SQL',()=>{const runner=fs.readFileSync(path.join(root,'scripts/test-writer-authorization.mjs'),'utf8');expect(runner).toContain('createCI176Database()');expect(runner).not.toContain('new PGlite(');const action=fs.readFileSync(path.join(root,'.github/actions/setup-ci-postgres176/action.yml'),'utf8');expect(action).toContain('e0630a3600aea27511715563259ec2111cd5f4353a4b040e0be827f94cd7a8b0');expect(action).toContain('--ignore-scripts');});
 test('no implicit APK version, application identity or signing change',()=>{expect(release.versionCode).toBe(196);expect(release.applicationVersion).toBe('1.2.9');expect(release.signingCertificateSha256).toBe('b6c51fff4d0df61569a423aa99df2ac5d5a92d3e897c1d30198980e59fcde96b');});
});
