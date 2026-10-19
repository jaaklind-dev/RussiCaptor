const { Buffer } = require('node:buffer');
const PACKAGE_ID = 'com.jaaklind.RussiCaptor.demo';
// Metro-generated import only. This is not a general application external or @react-native/* grant.
const ASSET_REGISTRY = Object.freeze({
  specifier: '@react-native/assets-registry/registry', version: '0.86.0',
  relativePath: '@react-native/assets-registry/registry.js',
  sha256: '4edff3064f1d79e8a0dd866b9163e13fbb48bec4d3a832ad7673b076d799bd7c',
  packageJsonSha256: '835ab65e7bed2b367029d1c07f3715ec87b5065ca44cc2bedf59976e80f42345',
});
const VIRTUAL_ASSET_REGISTRY = Object.freeze({
  id: '\0polyfill:assets-registry',
  sha256: '08d971df622a4b72fa1799ad924b850d6b014e0f9c5557822399a7ddccf92228',
  producerVersion: '57.0.6',
  producerRelativePath: 'expo/node_modules/@expo/cli/build/src/start/server/metro/withMetroMultiPlatform.js',
  producerSha256: '953421680566e30d277f1e635c2b56ad60cde46b25a59752e574a7fcba1c0f47',
  producerPackageJsonSha256: '0f72a0c80a9e11dd0f4713b85a692e364637d2fe90f9fe045f3c3c87789c18ce',
});
// Existing framework consumers only; no arbitrary app importer or node_modules directory grant.
const REGISTRY_IMPORTERS = Object.freeze({
  'react-native/Libraries/Image/resolveAssetSource.js': '4b9f298900bb16f73369eb806e30505d39c6e3a269bd93a8058a8fac6603f6ca',
  'react-native/Libraries/Image/AssetRegistry.js': '4f4913fe94704629a285bd40ae65627018545c0e8d1fbc14f8621b4cda4ec96e',
  'react-native/Libraries/Image/RelativeImageStub.js': '5edf8dfbc8e1ef11bafe15adf0563f7238851e23fb3f0954916175ad1c4732bf',
  'expo-asset/build/Asset.js': 'dae936a9d6522900a9d728b742b473db0bc16928a46741577fa98df12a3698bb',
  'expo-asset/build/resolveAssetSource.js': '2db350ee9f002f53529111627f03157c019b49208b240f5a711a0d2133212ef2',
});
function assertVirtualRegistrySource(source) {
  if(typeof source!=='string'&& !Buffer.isBuffer(source))throw new Error('OFFLINE_DEMO_VIRTUAL_SOURCE_INVALID');
  if(require('node:crypto').createHash('sha256').update(source).digest('hex')!==VIRTUAL_ASSET_REGISTRY.sha256)
    throw new Error('OFFLINE_DEMO_VIRTUAL_SOURCE_HASH_INVALID');
}
function verifyVirtualRegistryProducer(modulesRoot) {
  const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
  const root=fs.realpathSync(modulesRoot),file=path.join(root,VIRTUAL_ASSET_REGISTRY.producerRelativePath);
  const source=fs.readFileSync(file,'utf8'),metadata=fs.readFileSync(path.join(root,'expo/node_modules/@expo/cli/package.json'));
  if(fs.realpathSync(file)!==file||crypto.createHash('sha256').update(source).digest('hex')!==VIRTUAL_ASSET_REGISTRY.producerSha256||
    crypto.createHash('sha256').update(metadata).digest('hex')!==VIRTUAL_ASSET_REGISTRY.producerPackageJsonSha256||
    JSON.parse(metadata).version!==VIRTUAL_ASSET_REGISTRY.producerVersion)throw new Error('OFFLINE_DEMO_VIRTUAL_PRODUCER_INVALID');
  const matches=[...source.matchAll(/const ASSET_REGISTRY_SRC = `([^`]+)`/g)];
  if(matches.length!==1)throw new Error('OFFLINE_DEMO_VIRTUAL_PRODUCER_INVALID');
  assertVirtualRegistrySource(matches[0][1]);
  return {...VIRTUAL_ASSET_REGISTRY};
}
function assertRegistryImporter(origin,appRoot,modulesRoot) {
  const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
  const own=path.relative(appRoot,origin).split(path.sep).join('/');
  if(Object.hasOwn(AUDITED_DEMO_ASSETS,own)){assertAuditedDemoAsset(own,fs.readFileSync(origin));return;}
  const relative=path.relative(modulesRoot,origin).split(path.sep).join('/');
  if(!Object.hasOwn(REGISTRY_IMPORTERS,relative)||crypto.createHash('sha256').update(fs.readFileSync(origin)).digest('hex')!==REGISTRY_IMPORTERS[relative])
    throw new Error('OFFLINE_DEMO_REGISTRY_IMPORTER_FORBIDDEN');
}
function assertAssetRegistryBytes(bytes) {
  if (require('node:crypto').createHash('sha256').update(bytes).digest('hex') !== ASSET_REGISTRY.sha256)
    throw new Error('OFFLINE_DEMO_ASSET_REGISTRY_HASH_INVALID');
}
function verifyAssetRegistry(modulesRoot) {
  const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
  const root=fs.realpathSync(modulesRoot),expected=path.join(root,ASSET_REGISTRY.relativePath);
  if(fs.realpathSync(expected)!==expected)throw new Error('OFFLINE_DEMO_ASSET_REGISTRY_PATH_INVALID');
  const metadata=fs.readFileSync(path.join(root,'@react-native/assets-registry/package.json'));
  if(crypto.createHash('sha256').update(metadata).digest('hex')!==ASSET_REGISTRY.packageJsonSha256)
    throw new Error('OFFLINE_DEMO_ASSET_REGISTRY_PACKAGE_INVALID');
  const pkg=JSON.parse(metadata);
  if(pkg.name!=='@react-native/assets-registry'||pkg.version!==ASSET_REGISTRY.version)
    throw new Error('OFFLINE_DEMO_ASSET_REGISTRY_PACKAGE_INVALID');
  assertAssetRegistryBytes(fs.readFileSync(expected));
  return {...ASSET_REGISTRY,filePath:expected};
}
// Exact reviewed demo-owned sources; never a directory grant.
const AUDITED_DEMO_SOURCES = Object.freeze({
  'src/builder/DemoBuilderCapabilities.ts': '03242f51bbe874518a1b2bb8c69d9d18b20c5ed2673b88d096ebd9b8c841d0da',
  'src/builder/DemoBuilderDraft.ts': '26ea1942f3705851d7f890c27f90d7e3f8407cc8d42fca2a1cdc0d0b7bd57a77',
  'src/builder/DemoBuilderValidation.ts': '9d1b589ed799394cd2a904a5f2aa3eb9421483ffa387e6f73f60098aeef38b35',
  'src/builder/DemoBuilderStore.ts': 'ece718399bafba8ce71c84b1a85c445edd68f85af13efa96ca4a27ed1425b6ae',
  'src/builder/DemoBuilderApplication.tsx': '98f19a7b07b5e26e4109166eb34f6673ef0bdf2035db24dab032664edb268209',
  'src/builder/DemoBuilderEntry.tsx': '35dcb9adea61fecaf4f5c5e0bfd39a748b2891503c27a2503bc3ee08a1e5ab62',
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
module.exports = { PACKAGE_ID, ASSET_REGISTRY, VIRTUAL_ASSET_REGISTRY, REGISTRY_IMPORTERS, assertVirtualRegistrySource, verifyVirtualRegistryProducer, assertRegistryImporter, assertAssetRegistryBytes, verifyAssetRegistry, AUDITED_DEMO_SOURCES, AUDITED_DEMO_ASSETS, assertAuditedDemoAsset, assertAuditedDemoSource, SHARED_SOURCES, SHARED_ALIASES, assertOfflineEnvironment, assertSpecifier };
