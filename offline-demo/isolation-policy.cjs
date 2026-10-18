const PACKAGE_ID = 'com.jaaklind.RussiCaptor.demo';
// Exact reviewed demo-owned sources; never a directory grant.
const AUDITED_DEMO_SOURCES = Object.freeze({
  'src/runtime/DemoImaging.ts': '1b2b72b613f067875d10abe86af7231b38164e4ff491fe99b70f4d2680f9aee3',
  'src/runtime/DemoImagingCard.tsx': '2836ee7e771e805b1813a0529266d4a17f792e482d1ddea0230d55e971c36f4a',
  'assets/imaging/manifest.json': '130b7ebe540d7da602056f01cfc7af36cb19b9d6e320152a260ce6b229e9d51b',
  'src/runtime/DemoVitalsCard.tsx': 'fb3cb9a8c3162ee324303cc6507ebb9db1f22a28718187e8eae2b8eb21b97838',
  'src/runtime/DemoTime.ts': '358fd31e2dadacbae8a198b7a61fb9efcb3e0498e9e6b34f319b6a5588f19e44',
  'src/runtime/DemoLaboratoryCard.tsx': '797d48883696c71443c596f98efdb63e7da2a6b0c0e6383820a5e21fa2eb0b40',
  'src/runtime/DemoLaboratory.ts': 'c4813c65ad8887c96074b910003989abb23ef76f9fb1929dafbe344748255af7',
});
const AUDITED_DEMO_ASSETS = Object.freeze({
  'assets/imaging/pelvis-generated.jpg': '67e0866d46ae3ebee501fe7b10cdd1fff6c19a4f0886bfce646d9e5d314a5f39',
  'assets/imaging/chest-pneumothorax.png': 'c5a57c48190c85e8acbf067980f5741e3a895a5779ece097e6ebc259cc3ab2cd',
});
function assertAuditedDemoAsset(relative, bytes) {
  if(!Object.hasOwn(AUDITED_DEMO_ASSETS,relative)||require('node:crypto').createHash('sha256').update(bytes).digest('hex')!==AUDITED_DEMO_ASSETS[relative]) {
    throw new Error('OFFLINE_DEMO_ASSET_HASH_INVALID');
  }
}
function assertAuditedDemoSource(relative, bytes) {
  if (!Object.hasOwn(AUDITED_DEMO_SOURCES, relative) ||
      require('node:crypto').createHash('sha256').update(bytes).digest('hex') !== AUDITED_DEMO_SOURCES[relative]) {
    throw new Error('OFFLINE_DEMO_AUDITED_SOURCE_HASH_INVALID');
  }
}
// Exact reviewed pure engines/presentation only. A source change requires a fresh side-effect audit.
const SHARED_SOURCES = Object.freeze({
  'src/services/runtime/imaging/ImagingWorkflowCore.ts': '101e3bdbdee441e0678b683aedc4b10cda647e14a850c69f66dca0186e842b00',
  'src/models/ImagingWorkflow.ts': '4d2d5f98010b413a1e060dd83ce4d2bd064a1a15167c4959ce41bbb0d2306bbf',
  'src/services/runtime/HemorrhagePatientProcess.ts': '5ed38db24ccf079c2d49937e3552afe7ef6a78e9c961cbd1949eff88dc4e70b5',
  'src/services/runtime/PleuralInjuryPatientProcess.ts': '0d620316416bc3b37d72e8ab1ec8b8794255b7d3f7c575d9174ebe5006f8eec5',
  'src/services/runtime/RespiratoryFailurePatientProcess.ts': '935010d592766f94faa3d88a46db7a2a6b971d0c7d615263075553899be1ce33',
  'src/services/runtime/vitals/VitalSignEngine.ts': 'b81c7b37937b865a4df5f7bd1a4e13418d35607fe20d364054d358392291a146',
  'src/services/runtime/vitals/VitalSignProjection.ts': '5ac639346815a892110e73b46656a02ac6e3dbaa6ec1a7cca2d4290c8158948a',
  'src/components/patient/VitalsTab.tsx': '0ecd9874b49dcade28179a95e9c775913bf4b7c49a74e7526be8895ae0206598',
  'src/presentation/vitalSigns.ts': 'b756df51f94079d0b50ff2546e84b4336f84cf38574c7c466ce289dd823924e3',
  'src/config/NarvaLaboratoryCatalog.ts': '34290278320da5d0a2955288d98d4c1927edf49c93b2bf18f7e86edd154b0348',
  'src/utils/immutable.ts': 'b118e56a16b5c77fd3848fe98af861ec572d225b48e289fa06955b1daedfabf2',
  'src/services/runtime/laboratory/NarvaLabPhysiologyV1Generator.ts': 'd02d807bd560d9be8fd31b638e3bd30b25692488ca128f6096967a20ec61273b',
  'src/services/runtime/laboratory/NarvaLabPatientIdentity.ts': '0e5e5b6de553f98cf0ede4c7e8d9a4dc18a1327f1c851d5469c7fba02f0667f6',
  'src/components/patient/LaboratoryResultPresentation.ts': 'e36fc1ac799ac5485099372ae90aea26eddfec9e887dd5e8c1b71af1f66947cd',
});
// Only these exact aliases in reviewed, hash-pinned pure dependencies. No general @/ service access.
const SHARED_ALIASES = Object.freeze({
  '@/config/NarvaLaboratoryCatalog': 'src/config/NarvaLaboratoryCatalog.ts',
  '@/utils/immutable': 'src/utils/immutable.ts',
});
const EXTERNALS = new Set(['expo', 'expo-constants', 'expo-sqlite/kv-store', 'react', 'react-native',
  'react/jsx-runtime', 'react/jsx-dev-runtime', 'react/compiler-runtime']);
function assertOfflineEnvironment(env) {
  if (Object.keys(env).some(key => /SUPABASE|SERVICE_ROLE|^RUSSICAPTOR_RELEASE_|^EXPO_PUBLIC_RELEASE_ENVIRONMENT$/.test(key) && env[key])) {
    throw new Error('OFFLINE_DEMO_BACKEND_CONFIGURATION_FORBIDDEN');
  }
}
function assertSpecifier(specifier) {
  if (typeof specifier !== 'string' || (!specifier.startsWith('.') && !Object.hasOwn(SHARED_ALIASES, specifier) && !EXTERNALS.has(specifier) &&
      !/^@babel\/runtime\/helpers\/(?:esm\/)?[A-Za-z0-9_]+$/.test(specifier))) {
    throw new Error('OFFLINE_DEMO_IMPORT_FORBIDDEN');
  }
}
module.exports = { PACKAGE_ID, AUDITED_DEMO_SOURCES, AUDITED_DEMO_ASSETS, assertAuditedDemoAsset, assertAuditedDemoSource, SHARED_SOURCES, SHARED_ALIASES, assertOfflineEnvironment, assertSpecifier };
