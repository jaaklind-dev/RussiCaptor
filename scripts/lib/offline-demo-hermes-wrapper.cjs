#!/usr/bin/env node
// Build-only compiler boundary. No demo runtime imports this file.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { verifyBundle } = require('./offline-demo-imaging-data.cjs');
const args = process.argv.slice(2);
const outIndex = args.indexOf('-out');
if (outIndex < 0 || !process.env.DEMO_HERMESC || !process.env.DEMO_HERMES_EVIDENCE_DIR) throw new Error('OFFLINE_DEMO_COMPILER_BOUNDARY_INVALID');
const input = args[outIndex+2];
const code = fs.readFileSync(input,'utf8');
const evidence = verifyBundle(code);
const directory = process.env.DEMO_HERMES_EVIDENCE_DIR;
fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(path.join(directory,'verified-metro-input.js'),code);
const result = spawnSync(process.env.DEMO_HERMESC,args,{stdio:'inherit'});
if (result.error) throw new Error('OFFLINE_DEMO_COMPILER_FAILED');
if(result.status===0) {
  const outputSha256=crypto.createHash('sha256').update(fs.readFileSync(args[outIndex+1])).digest('hex');
  fs.writeFileSync(path.join(directory,'imaging-data.json'),JSON.stringify({...evidence,outputSha256}));
}
process.exit(result.status ?? 1);
