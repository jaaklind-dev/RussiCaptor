const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getDefaultConfig } = require('expo/metro-config');
const { assertSpecifier, SHARED_SOURCES, SHARED_ALIASES, AUDITED_DEMO_SOURCES, assertAuditedDemoSource, assertAuditedDemoAsset,
  ASSET_REGISTRY, verifyAssetRegistry } = require('./isolation-policy.cjs');
const config = getDefaultConfig(__dirname);
const appRoot = fs.realpathSync(__dirname);
const modulesRoot = fs.realpathSync(path.resolve(__dirname, '../node_modules'));
const repository = path.dirname(appRoot);
function shared(file) {
  const expected = SHARED_SOURCES[path.relative(repository, file).split(path.sep).join('/')];
  return expected && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === expected;
}
config.watchFolders = [modulesRoot, path.join(repository, 'src')];
config.resolver.nodeModulesPaths = [modulesRoot];
config.resolver.disableHierarchicalLookup = true;
config.resolver.resolveRequest = (context, specifier, platform) => {
  if (/supabase|expo-router|SupabaseService|OperatorSessionService|CloudSync|RuntimeCheckpointSync/i.test(specifier)) {
    throw new Error('OFFLINE_DEMO_PRODUCTION_MODULE_FORBIDDEN');
  }
  // Expo SDK 57 generates this exact in-memory assets registry. It is not a filesystem path.
  const virtualRegistry = '\0polyfill:assets-registry';
  const origin = context.originModulePath === virtualRegistry ? modulesRoot : fs.realpathSync(context.originModulePath);
  // A generated local image module may require exactly one hash-pinned, dependency-free registry.
  if (/\.(png|jpe?g)$/i.test(origin)) {
    assertAuditedDemoAsset(path.relative(appRoot,origin).split(path.sep).join('/'),fs.readFileSync(origin));
    if(specifier!==ASSET_REGISTRY.specifier)throw new Error('OFFLINE_DEMO_IMPORT_FORBIDDEN');
    const registry=verifyAssetRegistry(modulesRoot),result=context.resolveRequest(context,specifier,platform);
    if(result.type!=='sourceFile'||fs.realpathSync(result.filePath)!==registry.filePath)
      throw new Error('OFFLINE_DEMO_ASSET_REGISTRY_PATH_INVALID');
    return result;
  }
  if(origin===path.join(modulesRoot,ASSET_REGISTRY.relativePath)) {
    verifyAssetRegistry(modulesRoot);
    throw new Error('OFFLINE_DEMO_ASSET_REGISTRY_DEPENDENCY_FORBIDDEN');
  }
  if (origin.startsWith(appRoot + path.sep) || shared(origin)) assertSpecifier(specifier);
  const target = Object.hasOwn(SHARED_ALIASES, specifier) ? path.join(repository, SHARED_ALIASES[specifier]) : specifier;
  const result = context.resolveRequest(context, target, platform);
  for (const file of result.type === 'sourceFile' ? [result.filePath] : result.type === 'assetFiles' ? result.filePaths : []) {
    if (file === virtualRegistry) continue;
    const resolved = fs.realpathSync(file);
    if(resolved===path.join(modulesRoot,ASSET_REGISTRY.relativePath))verifyAssetRegistry(modulesRoot);
    const own = path.relative(appRoot, resolved).split(path.sep).join('/');
    if(/\.(png|jpe?g)$/i.test(own))assertAuditedDemoAsset(own,fs.readFileSync(resolved));
    if (Object.hasOwn(AUDITED_DEMO_SOURCES, own)) assertAuditedDemoSource(own, fs.readFileSync(resolved));
    if (!resolved.startsWith(appRoot + path.sep) && !resolved.startsWith(modulesRoot + path.sep) && !shared(resolved)) {
      throw new Error('OFFLINE_DEMO_SOURCE_ESCAPE_FORBIDDEN');
    }
  }
  return result;
};
module.exports = config;
