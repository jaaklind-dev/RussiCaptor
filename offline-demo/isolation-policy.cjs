const PACKAGE_ID = 'com.jaaklind.RussiCaptor.demo';
// Exact reviewed pure engines/presentation only. A source change requires a fresh side-effect audit.
const SHARED_SOURCES = Object.freeze({
  'src/services/runtime/HemorrhagePatientProcess.ts': '5ed38db24ccf079c2d49937e3552afe7ef6a78e9c961cbd1949eff88dc4e70b5',
  'src/services/runtime/PleuralInjuryPatientProcess.ts': '0d620316416bc3b37d72e8ab1ec8b8794255b7d3f7c575d9174ebe5006f8eec5',
  'src/services/runtime/RespiratoryFailurePatientProcess.ts': '935010d592766f94faa3d88a46db7a2a6b971d0c7d615263075553899be1ce33',
  'src/services/runtime/vitals/VitalSignEngine.ts': 'b81c7b37937b865a4df5f7bd1a4e13418d35607fe20d364054d358392291a146',
  'src/services/runtime/vitals/VitalSignProjection.ts': '5ac639346815a892110e73b46656a02ac6e3dbaa6ec1a7cca2d4290c8158948a',
  'src/components/patient/VitalsTab.tsx': '7b88d48170958efc956ed5ea2c4ebbfac30435bc755fa223fe8071f0ee3eafee',
});
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
module.exports = { PACKAGE_ID, SHARED_SOURCES, assertOfflineEnvironment, assertSpecifier };
