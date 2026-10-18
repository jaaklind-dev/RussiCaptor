const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getDefaultConfig } = require('expo/metro-config');
const { assertSpecifier, SHARED_SOURCES, SHARED_ALIASES, AUDITED_DEMO_SOURCES, assertAuditedDemoSource, assertAuditedDemoAsset,
  ASSET_REGISTRY, verifyAssetRegistry, VIRTUAL_ASSET_REGISTRY, verifyVirtualRegistryProducer, assertRegistryImporter } = require('./isolation-policy.cjs');
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
  const virtualRegistry = VIRTUAL_ASSET_REGISTRY.id;
  if(context.originModulePath.includes('\0')) {
    if(context.originModulePath===virtualRegistry)throw new Error('OFFLINE_DEMO_ASSET_REGISTRY_DEPENDENCY_FORBIDDEN');
    throw new Error('OFFLINE_DEMO_VIRTUAL_MODULE_FORBIDDEN');
  }
  const origin = fs.realpathSync(context.originModulePath);
  // A generated local image module may require exactly one hash-pinned, dependency-free registry.
  if (/\.(png|jpe?g)$/i.test(origin)) {
    assertAuditedDemoAsset(path.relative(appRoot,origin).split(path.sep).join('/'),fs.readFileSync(origin));
    if(specifier!==ASSET_REGISTRY.specifier)throw new Error('OFFLINE_DEMO_IMPORT_FORBIDDEN');
    const registry=verifyAssetRegistry(modulesRoot),result=context.resolveRequest(context,specifier,platform);
    if(result.type==='sourceFile'&&result.filePath===virtualRegistry){
      verifyVirtualRegistryProducer(modulesRoot);
      // Actual emitted bytes are additionally checked through Expo's real resolver probe and final source map.
      return result;
    }
    if(result.type==='sourceFile'&&result.filePath.includes('\0'))throw new Error('OFFLINE_DEMO_VIRTUAL_MODULE_FORBIDDEN');
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
    if(file===virtualRegistry){
      if(specifier!==ASSET_REGISTRY.specifier)throw new Error('OFFLINE_DEMO_REGISTRY_IMPORTER_FORBIDDEN');
      assertRegistryImporter(origin,appRoot,modulesRoot);verifyVirtualRegistryProducer(modulesRoot);continue;
    }
    if(file.includes('\0')) {
      if(file==='\0polyfill:external-require')continue; // Existing exact external-require exception, not an asset-registry wildcard.
      throw new Error('OFFLINE_DEMO_VIRTUAL_MODULE_FORBIDDEN');
    }
    const resolved = fs.realpathSync(file);
    if(resolved===path.join(modulesRoot,ASSET_REGISTRY.relativePath)){assertRegistryImporter(origin,appRoot,modulesRoot);verifyAssetRegistry(modulesRoot);}
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
