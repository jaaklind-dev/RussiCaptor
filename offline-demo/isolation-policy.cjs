const PACKAGE_ID = 'com.jaaklind.RussiCaptor.demo';
const EXTERNALS = new Set(['expo', 'expo-constants', 'expo-sqlite/kv-store', 'react', 'react-native',
  'react/jsx-runtime', 'react/jsx-dev-runtime', 'react/compiler-runtime']);
function assertOfflineEnvironment(env) {
  if (Object.keys(env).some(key => /SUPABASE|SERVICE_ROLE|^RUSSICAPTOR_RELEASE_|^EXPO_PUBLIC_RELEASE_ENVIRONMENT$/.test(key) && env[key])) {
    throw new Error('OFFLINE_DEMO_BACKEND_CONFIGURATION_FORBIDDEN');
  }
}
function assertSpecifier(specifier) {
  if (typeof specifier !== 'string' || (!specifier.startsWith('.') && !EXTERNALS.has(specifier) &&
      !/^@babel\/runtime\/helpers\/(?:esm\/)?[A-Za-z0-9_]+$/.test(specifier))) {
    throw new Error('OFFLINE_DEMO_IMPORT_FORBIDDEN');
  }
}
module.exports = { PACKAGE_ID, assertOfflineEnvironment, assertSpecifier };
