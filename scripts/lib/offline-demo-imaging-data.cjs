const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse } = require('@babel/parser');
const policy = require('../../offline-demo/isolation-policy.cjs');
const relative = 'assets/imaging/manifest.json';
const root = path.resolve(__dirname, '../../offline-demo');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function validateData(value) {
  const fail = () => { throw new Error('OFFLINE_DEMO_IMAGING_DATA_INVALID'); };
  if (!value || value.schemaVersion !== 1 || value.fixtureVersion !== 'russicaptor.offline-demo.imaging@1.0.0' ||
      Object.keys(value).sort().join(',') !== 'assets,fixtureVersion,schemaVersion' || !Array.isArray(value.assets) || value.assets.length !== 2) fail();
  const expected = [
    ['offline-demo.pelvis.generated.v1','DEMO-PT-A','DEMO-PELVIS-XR','pelvis-generated.jpg','image/jpeg',1280,948,'DEMO-PELVIS-REPORT-v1'],
    ['offline-demo.chest.heilman.v1','DEMO-PT-B','DEMO-CHEST-XR','chest-pneumothorax.png','image/png',1041,962,'DEMO-CHEST-REPORT-v1'],
  ];
  const keys = 'assetId,attribution,clinicalBoundary,creator,examinationId,file,format,height,license,licenseUrl,modification,patientId,report,reportId,sha256,source,version,width';
  value.assets.forEach((asset,index) => {
    const actual = ['assetId','patientId','examinationId','file','format','width','height','reportId'].map(key=>asset[key]);
    if (JSON.stringify(actual) !== JSON.stringify(expected[index]) || Object.keys(asset).sort().join(',') !== keys ||
        asset.sha256 !== policy.AUDITED_DEMO_ASSETS['assets/imaging/'+asset.file] || asset.version !== '1.0.0') fail();
    for (const [key,text] of Object.entries(asset)) {
      if (typeof text === 'string' && /https?:/.test(text) && !(
        index === 1 && ((key === 'source' && text === 'https://commons.wikimedia.org/wiki/File:Tpneumopneumomed.png') ||
        (key === 'licenseUrl' && text === 'https://creativecommons.org/licenses/by-sa/3.0/')))) fail();
    }
  });
  return value;
}
function verifySource(bytes = fs.readFileSync(path.join(root,relative))) {
  policy.assertAuditedDemoSource(relative,bytes);
  return validateData(JSON.parse(bytes.toString()));
}
// Inspect the real Metro JavaScript input to Hermes without executing application code.
// JSON has no source-map entry: its factory exports a JSON literal instead.
function verifyBundle(code, bytes = fs.readFileSync(path.join(root,relative))) {
  const expected = verifySource(bytes), found = [];
  const ast = parse(code,{sourceType:'script'});
  for (const statement of ast.program.body) {
    const call = statement.expression;
    if (call?.type !== 'CallExpression' || call.callee.type !== 'Identifier' || call.callee.name !== '__d') continue;
    const factory = call.arguments[0];
    if (factory?.type !== 'FunctionExpression') continue;
    for (const item of factory.body.body) {
      const assignment = item.expression;
      if (assignment?.type !== 'AssignmentExpression' || assignment.operator !== '=' || assignment.right.type !== 'ObjectExpression') continue;
      const object = assignment.right;
      if (!object.properties.some(prop => (prop.key?.value ?? prop.key?.name) === 'fixtureVersion')) continue;
      if (factory.body.body.length !== 1 || assignment.left.type !== 'MemberExpression' || assignment.left.computed ||
          assignment.left.object.name !== 'module' || assignment.left.property.name !== 'exports') throw new Error('OFFLINE_DEMO_IMAGING_BUNDLE_INVALID');
      let value;
      try { value = JSON.parse(code.slice(object.start,object.end)); } catch { throw new Error('OFFLINE_DEMO_IMAGING_BUNDLE_INVALID'); }
      validateData(value);
      if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error('OFFLINE_DEMO_IMAGING_BUNDLE_MISMATCH');
      found.push(value);
    }
  }
  if (found.length !== 1) throw new Error('OFFLINE_DEMO_IMAGING_BUNDLE_MISSING');
  return {sourceSha256:digest(bytes),dataSha256:digest(JSON.stringify(found[0])),compilerInputSha256:digest(code)};
}
function verifyPackagedData(packaged,source,code) {
  if (!packaged.equals(source)) throw new Error('OFFLINE_DEMO_PACKAGED_IMAGING_DATA_MISMATCH');
  return verifyBundle(code,packaged);
}
module.exports = {relative,verifySource,validateData,verifyBundle,verifyPackagedData};
