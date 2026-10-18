const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getDefaultConfig } = require('expo/metro-config');
const { assertSpecifier, SHARED_SOURCES } = require('./isolation-policy.cjs');
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
  if (origin.startsWith(appRoot + path.sep) || shared(origin)) assertSpecifier(specifier);
  const result = context.resolveRequest(context, specifier, platform);
  for (const file of result.type === 'sourceFile' ? [result.filePath] : result.type === 'assetFiles' ? result.filePaths : []) {
    if (file === virtualRegistry) continue;
    const resolved = fs.realpathSync(file);
    if (!resolved.startsWith(appRoot + path.sep) && !resolved.startsWith(modulesRoot + path.sep) && !shared(resolved)) {
      throw new Error('OFFLINE_DEMO_SOURCE_ESCAPE_FORBIDDEN');
    }
  }
  return result;
};
module.exports = config;
