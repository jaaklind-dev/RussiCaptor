import assert from 'node:assert/strict';

// Supabase CLI2.121.0 db-push-core.ts explicitly emits this contract for both
// apply and no-op under --output-format json. Text output is never accepted.
export function parseDbPushResult({ stdout, stderr, exitCode }) {
  assert.equal(exitCode,0,'CLI_PROCESS_FAILED');
  assert.equal(typeof stdout,'string'); assert.equal(typeof stderr,'string');
  assert.ok(stdout.trim(),'CLI_OUTPUT_EMPTY');
  let output;
  try { output=JSON.parse(stdout); } catch { throw new Error('CLI_OUTPUT_NOT_JSON'); }
  assert.ok(output && typeof output==='object' && !Array.isArray(output),'CLI_OUTPUT_SCHEMA');
  assert.deepEqual(Object.keys(output).sort(),['dryRun','message','migrations','roles','seeds','upToDate'].sort(),'CLI_OUTPUT_SCHEMA');
  assert.equal(typeof output.upToDate,'boolean','CLI_OUTPUT_SCHEMA');
  assert.equal(output.dryRun,false,'CLI_DRY_RUN_FORBIDDEN');
  assert.ok(Array.isArray(output.migrations),'CLI_OUTPUT_SCHEMA');
  for(const file of output.migrations) assert.match(file,/^\d+_[a-z0-9_]+\.sql$/,'CLI_OUTPUT_SCHEMA');
  assert.equal(new Set(output.migrations).size,output.migrations.length,'CLI_DUPLICATE_MIGRATION');
  assert.deepEqual(output.seeds,[],'CLI_SEED_FORBIDDEN'); assert.deepEqual(output.roles,[],'CLI_ROLES_FORBIDDEN');
  if(output.upToDate){
    assert.deepEqual(output.migrations,[],'CLI_NOOP_CONFLICT');
    assert.match(output.message,/^(Local|Remote) database is up to date\.$/,'CLI_OUTPUT_SCHEMA');
  } else {
    assert.ok(output.migrations.length>0,'CLI_APPLY_EMPTY');
    assert.equal(output.message,'Finished supabase db push.','CLI_OUTPUT_SCHEMA');
  }
  return {...output,kind:output.upToDate?'noop':'applied'};
}

export function assertDbPushDatabaseState(parsed,{previousLedger,ledger,expectedLedger,schemaMatches}) {
  assert.equal(schemaMatches,true,'CLI_DATABASE_SCHEMA_MISMATCH');
  assert.deepEqual(ledger,expectedLedger,'CLI_DATABASE_LEDGER_MISMATCH');
  if(parsed.kind==='noop') assert.deepEqual(ledger,previousLedger,'CLI_NOOP_DATABASE_CONFLICT');
  else assert.deepEqual(ledger,[...previousLedger,...parsed.migrations.map(f=>f.split('_')[0])],'CLI_APPLY_DATABASE_CONFLICT');
}
