const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const policy=require('../../offline-demo/isolation-policy.cjs');
/** Real installed Expo resolver/virtual-module writer. Only Metro's host filesystem is in memory. */
function createExpoRegistryProbe() {
  const modules=fs.realpathSync(path.join(root,'node_modules'));
  policy.verifyVirtualRegistryProducer(modules);
  const producer=require(path.join(modules,policy.VIRTUAL_ASSET_REGISTRY.producerRelativePath));
  const base=require('../../offline-demo/metro.config.cjs');
  const fileSystem={getSha1:()=>{throw new Error('PROBE_UNEXPECTED_PHYSICAL_READ');}};
  const graph={_fileSystem:fileSystem};
  const bundler={_depGraph:graph,transformFile:async()=>{},getDependencyGraph:async()=>graph};
  const config=producer.withExtendedResolver(base,{isTsconfigPathsEnabled:false,isExporting:true,
    isReactServerComponentsEnabled:false,getMetroBundler:()=>bundler});
  return {
    resolve(origin,specifier=policy.ASSET_REGISTRY.specifier) {
      return config.resolver.resolveRequest({originModulePath:origin,dev:false,customResolverOptions:{exporting:true},
        sourceExts:base.resolver.sourceExts,resolveRequest:()=>{throw new Error('PROBE_UNEXPECTED_FALLBACK');}},specifier,'android');
    },
    source(id=policy.VIRTUAL_ASSET_REGISTRY.id){return fileSystem.expoVirtualModules?.get(id)?.toString('utf8');},
  };
}
function verifyGeneratedVirtualRegistry() {
  const probe=createExpoRegistryProbe();
  for(const file of Object.keys(policy.AUDITED_DEMO_ASSETS)) {
    const result=probe.resolve(path.join(root,'offline-demo',file));
    if(result.type!=='sourceFile'||result.filePath!==policy.VIRTUAL_ASSET_REGISTRY.id)throw new Error('OFFLINE_DEMO_VIRTUAL_RESOLUTION_INVALID');
    policy.assertVirtualRegistrySource(probe.source());
  }
  return {...policy.VIRTUAL_ASSET_REGISTRY};
}
module.exports={createExpoRegistryProbe,verifyGeneratedVirtualRegistry};
