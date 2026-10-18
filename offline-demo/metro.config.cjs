const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { assertSpecifier } = require('./isolation-policy.cjs');
const config = getDefaultConfig(__dirname);
const appRoot = fs.realpathSync(__dirname);
const modulesRoot = fs.realpathSync(path.resolve(__dirname, '../node_modules'));
config.watchFolders = [modulesRoot];
config.resolver.nodeModulesPaths = [modulesRoot];
config.resolver.disableHierarchicalLookup = true;
config.resolver.resolveRequest = (context, specifier, platform) => {
  if (/supabase|expo-router|SupabaseService|OperatorSessionService|CloudSync|RuntimeCheckpointSync/i.test(specifier)) {
    throw new Error('OFFLINE_DEMO_PRODUCTION_MODULE_FORBIDDEN');
  }
  const origin = fs.realpathSync(context.originModulePath);
  if (origin.startsWith(appRoot + path.sep)) assertSpecifier(specifier);
  const result = context.resolveRequest(context, specifier, platform);
  for (const file of result.type === 'sourceFile' ? [result.filePath] : result.type === 'assetFiles' ? result.filePaths : []) {
    const resolved = fs.realpathSync(file);
    if (!resolved.startsWith(appRoot + path.sep) && !resolved.startsWith(modulesRoot + path.sep)) {
      throw new Error('OFFLINE_DEMO_SOURCE_ESCAPE_FORBIDDEN');
    }
  }
  return result;
};
module.exports = config;
