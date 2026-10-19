const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const babel = require('@babel/core');
const t = require('@babel/types');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = reason => { throw new Error(`CANONICAL_ACCEPTANCE_EXCLUSION: ${reason}`); };
const forbidden = ['SharedWorkflowValidationCard', 'SharedWorkflowValidationHarness', 'PhysicalValidationHarnessService',
  'PhysicalValidationHarnessCore', 'LaboratoryActionDiagnostics', 'CmOwnershipDiagnosticsService',
  'RuntimeLeaseLifecycleTrace', 'RuntimeCheckpointPublicationValidationHarness', 'RuntimeLeaseTimerProbe'];
const blockedImport = source => forbidden.includes(source.split('/').at(-1));
const callbacks = new Set(['startRuntimeWorkTrace', 'startRuntimeLeaseTimerProbe']);
const arrays = new Set(['getRuntimeLeaseLifecycleTrace', 'getLaboratoryActionTrace', 'getCmOwnershipTrace']);
const falses = new Set(['isSharedWorkflowValidationHarnessEnabled', 'armNextRuntimeCheckpointPublicationLostResponseForValidation',
  'isRuntimeCheckpointPublicationLostResponseArmedForValidation', 'clearRuntimeCheckpointPublicationLostResponseForValidation', 'clearRuntimeLeaseTraceForValidation']);
function replaceCall(name, args) {
  if (name === 'interceptRuntimeCheckpointPublicationResponseForValidation') return args[0];
  const value = callbacks.has(name) ? t.arrowFunctionExpression([], t.blockStatement([])) : arrays.has(name) ? t.arrayExpression([]) :
    falses.has(name) ? t.booleanLiteral(false) : name === 'nextRuntimeLeaseTraceLabel' ? t.stringLiteral('') : t.unaryExpression('void', t.numericLiteral(0));
  // Preserve argument evaluation, even though the disabled recorder has no effect.
  return args.length ? t.sequenceExpression([...args, value]) : value;
}
function terminal(node) { return t.isReturnStatement(node) || t.isThrowStatement(node) ||
  (t.isBlockStatement(node) && node.body.length > 0 && terminal(node.body.at(-1))); }
function fold(p) {
  if (p.isUnaryExpression({ operator: '!' }) && t.isBooleanLiteral(p.node.argument)) p.replaceWith(t.booleanLiteral(!p.node.argument.value));
  else if (p.isLogicalExpression() && ['&&', '||'].includes(p.node.operator) && t.isBooleanLiteral(p.node.left)) {
    const { left, right, operator } = p.node;
    p.replaceWith(operator === '&&' ? left.value ? right : left : left.value ? left : right);
  } else if (p.isConditionalExpression() && t.isBooleanLiteral(p.node.test)) p.replaceWith(p.node.test.value ? p.node.consequent : p.node.alternate);
  else if (p.isIfStatement() && t.isBooleanLiteral(p.node.test)) {
    if (p.node.test.value) p.replaceWith(p.node.consequent);
    else if (p.node.alternate) p.replaceWith(p.node.alternate); else p.remove();
  } else if (p.isBlockStatement()) {
    const index = p.node.body.findIndex(terminal); if (index >= 0) p.node.body = p.node.body.slice(0, index + 1);
  }
}
function rewrite(src, filename) {
  return babel.transformSync(src, { filename, configFile: false, babelrc: false, comments: false,
    parserOpts: { sourceType: 'module', plugins: ['typescript', 'jsx'] }, plugins: [() => ({ visitor: {
      Program(program) {
        const imported = new Map();
        program.get('body').filter(p => p.isImportDeclaration() && blockedImport(p.node.source.value)).forEach(p => {
          p.node.specifiers.forEach(s => {
            if (t.isImportNamespaceSpecifier(s)) fail('namespace acceptance import');
            imported.set(s.local.name, t.isImportDefaultSpecifier(s) ? 'SharedWorkflowValidationCard' : s.imported.name);
          });
        });
        const runtime = filename.endsWith('/RuntimeCheckpointSyncService.ts');
        const manual = new Set(['manualRenewLeaseForValidation', 'manualRenewInFlight', 'manualRenew']);
        program.traverse({
          CallExpression(p) {
            const name = t.isIdentifier(p.node.callee) ? p.node.callee.name : '';
            if (imported.has(name)) {
              if (name === 'isSharedWorkflowValidationHarnessEnabled') p.replaceWith(t.booleanLiteral(false));
              else p.replaceWith(replaceCall(imported.get(name), p.node.arguments));
            } else if (runtime && name === 'recordRenewalDiagnostic') p.replaceWith(replaceCall(name, p.node.arguments));
          },
          ExportNamedDeclaration(p) { if (runtime && t.isFunctionDeclaration(p.node.declaration) && p.node.declaration.id?.name === 'renewRuntimeLeaseNowForValidation') p.remove(); },
          FunctionDeclaration(p) { if (runtime && p.node.id?.name === 'recordRenewalDiagnostic') p.remove(); },
          VariableDeclarator(p) {
            if (runtime && t.isIdentifier(p.node.id) && manual.has(p.node.id.name)) p.remove();
            if (filename.endsWith('/app/excon/diagnostics.tsx') && t.isArrayPattern(p.node.id) &&
              p.node.id.elements.some(n => t.isIdentifier(n) && ['validationRenewal', 'lostResponseArmed'].includes(n.name))) p.remove();
          },
          ExpressionStatement(p) {
            const e = p.node.expression;
            if (runtime && t.isAssignmentExpression(e) && t.isIdentifier(e.left) && manual.has(e.left.name)) p.remove();
            if (filename.endsWith('/app/excon/diagnostics.tsx') && t.isCallExpression(e) && t.isIdentifier(e.callee, { name: 'setLostResponseArmed' })) p.remove();
          },
          IfStatement(p) { if (runtime && t.isBinaryExpression(p.node.test) && t.isIdentifier(p.node.test.left, { name: 'manualRenewLeaseForValidation' })) p.remove(); },
        });
        for (let pass = 0; pass < 4; pass++) program.traverse({ exit: fold });
        program.scope.crawl();
        program.get('body').filter(p => p.isImportDeclaration()).forEach(p => {
          const special = blockedImport(p.node.source.value) || p.node.source.value.endsWith('/RuntimeCheckpointSyncService');
          if (!special) return;
          p.node.specifiers = p.node.specifiers.filter(s => {
            const binding = program.scope.getBinding(s.local.name);
            return binding?.referenced || (!blockedImport(p.node.source.value) && s.local.name !== 'renewRuntimeLeaseNowForValidation');
          });
          if (!p.node.specifiers.length) p.remove();
          else if (blockedImport(p.node.source.value)) fail(`acceptance binding remains in ${filename}`);
        });
      },
    } })] }).code;
}
function profile(root) { return JSON.parse(fs.readFileSync(path.join(root, 'release/canonical-acceptance-profile.json'), 'utf8')); }
function transformSource(root, filename, src, canonical) {
  if (!canonical) return src;
  const relative = path.relative(root, filename).split(path.sep).join('/');
  if (!relative.startsWith('src/')) return src;
  if (forbidden.includes(path.basename(relative).replace(/\.[^.]+$/, ''))) fail(`forbidden module reached: ${relative}`);
  const policy = profile(root), item = policy.sources.find(s => s.path === relative);
  if (!item) {
    if (forbidden.some(name => src.includes(name))) fail(`unaudited acceptance dependency: ${relative}`);
    return src;
  }
  if (sha(src) !== item.sourceSha256) fail(`source hash changed: ${relative}`);
  const result = relative === 'src/services/sharedWorkflow/SharedWorkflowMutationService.ts'
    ? fs.readFileSync(path.join(root, policy.canonicalRpc.path), 'utf8') : rewrite(src, filename);
  if (sha(result) !== item.canonicalSha256) fail(`canonical hash changed: ${relative}`);
  return result;
}
function canonicalMode(env) {
  const mode = env.RUSSICAPTOR_RELEASE_VARIANT;
  if (!mode) return false;
  if (!['canonical', 'predeployment-candidate', 'upgrade-validation', 'rollback-validation'].includes(mode)) fail('unknown build mode');
  const validation = mode.endsWith('-validation');
  if (!validation && env.RUSSICAPTOR_ENABLE_SHARED_WORKFLOW_VALIDATION_HARNESS === '1') fail('canonical harness flag');
  return !validation;
}
function evidence(root, mode) {
  return { schemaVersion: 1, profile: mode.endsWith('-validation') ? 'validation' : 'canonical',
    policySha256: sha(['release/canonical-acceptance-profile.json', 'scripts/canonical-acceptance-profile.cjs',
      'scripts/acceptance-profile-transformer.cjs', 'metro.config.js', 'release/canonical-profile/SharedWorkflowMutationService.ts']
      .map(file => fs.readFileSync(path.join(root, file))).join('\n')) };
}
function verifySources(root, canonical) {
  return profile(root).sources.map(item => {
    const src = fs.readFileSync(path.join(root, item.path), 'utf8');
    if (sha(src) !== item.sourceSha256) fail(`source hash changed: ${item.path}`);
    return { path: item.path, sourceSha256: sha(src), bundledSourceSha256: sha(transformSource(root, path.join(root, item.path), src, canonical)) };
  });
}
function verifyBundle(bytes, mode) {
  const banned = ['SW-VALIDATION-', 'NEGATIVE_TEST', 'VALIDATION_BINDING_CHANGED', 'LAB_ACTION_TRACE', 'CM_OWNERSHIP_TRACE',
    'RUNTIME_LEASE_TRACE', 'VALIDATION_PUBLICATION_LOST_RESPONSE_ARMED', 'MANUAL_RENEW_INVOKED', 'validation-renew'];
  const validation = mode.endsWith('-validation');
  const markers = banned.map(marker => ({ marker, present: bytes.includes(Buffer.from(marker)) }));
  if (!validation && markers.some(m => m.present)) fail(`acceptance marker remains: ${markers.find(m => m.present).marker}`);
  return { status: 'PASS', profile: validation ? 'validation' : 'canonical', bundleSha256: sha(bytes), markers };
}
module.exports = { sha, rewrite, transformSource, canonicalMode, forbidden, evidence, verifySources, verifyBundle };
