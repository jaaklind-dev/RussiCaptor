import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policy = require(path.join(repository, 'offline-demo/isolation-policy.cjs'));
export function verifyDemoGraph(root = path.join(repository, 'offline-demo'), entry = 'index.js') {
  const base = fs.realpathSync(root), visited = new Set(), sharedVisited = new Set();
  function visit(file) {
    const real = fs.realpathSync(file);
    const expected = policy.SHARED_SOURCES[path.relative(repository, real).split(path.sep).join('/')];
    const shared = base === fs.realpathSync(path.join(repository, 'offline-demo')) && expected && crypto.createHash('sha256').update(fs.readFileSync(real)).digest('hex') === expected;
    if (!real.startsWith(base + path.sep) && !shared) throw new Error('OFFLINE_DEMO_SOURCE_ESCAPE_FORBIDDEN');
    if (visited.has(real)) return;
    visited.add(real);
    if (shared) sharedVisited.add(real);
    const demoRelative = path.relative(base, real).split(path.sep).join('/');
    if(/\.(png|jpe?g)$/i.test(real)) {
      policy.assertAuditedDemoAsset(demoRelative,fs.readFileSync(real));return;
    }
    const text = fs.readFileSync(real, 'utf8');
    if (Object.hasOwn(policy.AUDITED_DEMO_SOURCES, demoRelative)) policy.assertAuditedDemoSource(demoRelative, text);
    // Only this exact hash-pinned JSON data document may carry source/license URLs. It cannot execute code.
    if(demoRelative==='assets/imaging/manifest.json') {
      policy.assertAuditedDemoSource(demoRelative,text);JSON.parse(text);return;
    }
    if (/https?:|SUPABASE|SERVICE_ROLE|access_token|refresh_token|eval\s*\(|new\s+Function/.test(text)) throw new Error('OFFLINE_DEMO_UNSAFE_SOURCE');
    const ast = ts.createSourceFile(real, text, ts.ScriptTarget.Latest, true, real.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function dependency(node) {
      let specifier;
      if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) {
        const name = node.moduleSpecifier.text;
        if (!(name.startsWith('.') || name.startsWith('@/models/') || ['@/services/VitalSignsService', '@/services/RuntimeSnapshotService'].includes(name))) throw new Error('OFFLINE_DEMO_TYPE_IMPORT_FORBIDDEN');
        return; // Explicit type-only imports are erased; they cannot initialize a module.
      }
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (ts.isImportEqualsDeclaration(node)) throw new Error('OFFLINE_DEMO_DYNAMIC_IMPORT_FORBIDDEN');
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        if (node.arguments.length !== 1) throw new Error('OFFLINE_DEMO_DYNAMIC_IMPORT_FORBIDDEN');
        specifier = node.arguments[0];
      }
      if (specifier) {
        if (!ts.isStringLiteral(specifier)) throw new Error('OFFLINE_DEMO_DYNAMIC_IMPORT_FORBIDDEN');
        const name = specifier.text; policy.assertSpecifier(name);
        if (name.startsWith('.') || Object.hasOwn(policy.SHARED_ALIASES, name)) {
          const target = Object.hasOwn(policy.SHARED_ALIASES, name)
            ? path.join(repository, policy.SHARED_ALIASES[name]) : path.resolve(path.dirname(real), name);
          const candidate = [target, target+'.ts', target+'.tsx', target+'.js', target+'.cjs'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
          if (!candidate) throw new Error('OFFLINE_DEMO_IMPORT_UNRESOLVED');
          visit(candidate);
        }
      }
      ts.forEachChild(node, dependency);
    }
    dependency(ast);
  }
  visit(path.join(base, entry));
  return { status: 'PASS', applicationModules: visited.size, auditedSharedPureModules: sharedVisited.size, productionImports: 0, productionServiceImports: 0 };
}
export function verifyOfflineDemo() {
  policy.verifyAssetRegistry(path.join(repository,'node_modules'));
  const assetRegistry={...policy.ASSET_REGISTRY};
  const config = require(path.join(repository,'offline-demo/app.config.cjs'))();
  const pkg = JSON.parse(fs.readFileSync(path.join(repository,'offline-demo/package.json'),'utf8'));
  const buildPolicy = JSON.parse(fs.readFileSync(path.join(repository,'offline-demo/build-policy.json'),'utf8'));
  if (config.android.package !== policy.PACKAGE_ID || pkg.main !== 'index.js' || config.scheme ||
      config.plugins.includes('expo-router') || config.updates.enabled || config.extra.offlineDemo.productionAccess !== false ||
      !config.android.blockedPermissions.includes('android.permission.INTERNET') || config.android.permissions.length ||
      config.extra.offlineDemo.distributable !== false || config.extra.offlineDemo.publicationAuthorization !== 'NOT_GRANTED' ||
      config.version !== buildPolicy.applicationVersion || pkg.version !== config.version || config.android.versionCode !== buildPolicy.versionCode) throw new Error('OFFLINE_DEMO_CONFIGURATION_INVALID');
  const root = path.join(repository,'offline-demo');
  const source = fs.readFileSync(path.join(root,'index.js'),'utf8');
  if (!(source.indexOf('installOfflineNetworkBoundary(globalThis)') < source.indexOf("require('expo')"))) throw new Error('OFFLINE_DEMO_BOUNDARY_ORDER_INVALID');
  return { ...verifyDemoGraph(), assetRegistry, packageId: config.android.package, internetPermissionRequested: false,
    nativeArtifactVerified: false, apkBuildPerformed: false, publicationAuthorization: 'NOT_GRANTED' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(verifyOfflineDemo()));
