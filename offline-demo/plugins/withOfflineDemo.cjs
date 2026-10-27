const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const { PACKAGE_ID } = require('../isolation-policy.cjs');
function hardenManifest(manifest) {
  if (manifest.$?.['android:sharedUserId'] || manifest.$?.package && manifest.$.package !== PACKAGE_ID) {
    throw new Error('OFFLINE_DEMO_NATIVE_IDENTITY_INVALID');
  }
  manifest.$ = { ...manifest.$, 'xmlns:tools': 'http://schemas.android.com/tools' };
  const denied = new Set(['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.CAMERA', 'android.permission.RECORD_AUDIO',
    'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.READ_MEDIA_IMAGES']);
  for (const tag of ['uses-permission', 'uses-permission-sdk-23']) {
    const permissions = manifest[tag] || [];
    for (const item of permissions) { const name = item.$?.['android:name']; if (name) denied.add(name); }
    manifest[tag] = [...denied].map(name => ({ $: { 'android:name': name, 'tools:node': 'remove' } }));
  }
  for (const application of manifest.application || []) {
    application.$ = { ...application.$, 'android:label': 'RussiCaptor DEMO', 'android:icon': '@drawable/offline_demo_icon',
      'android:roundIcon': '@drawable/offline_demo_icon', 'android:allowBackup': 'false', 'android:usesCleartextTraffic': 'false' };
    // Only a launcher entry is allowed. Remove merged schemes, app links and extra entry components.
    application.activity = (application.activity || []).filter(a => a.$?.['android:name'] === '.MainActivity');
    if (application.activity.length !== 1) throw new Error('OFFLINE_DEMO_ACTIVITY_INVALID');
    const activity = application.activity[0];
    activity.$ = { ...activity.$, 'android:exported': 'true' };
    activity['intent-filter'] = [{ action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
      category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] }];
    for (const kind of ['activity-alias','service','receiver','provider']) {
      for (const component of application[kind] || []) component.$ = { ...component.$, 'android:exported': 'false' };
    }
  }
  if ((manifest.application || []).length !== 1) throw new Error('OFFLINE_DEMO_APPLICATION_INVALID');
  return manifest;
}
module.exports = config => {
  if (config.android?.package !== PACKAGE_ID) throw new Error('OFFLINE_DEMO_PACKAGE_REQUIRED');
  config = withAndroidManifest(config, mod => { mod.modResults.manifest = hardenManifest(mod.modResults.manifest); return mod; });
  return withDangerousMod(config, ['android', mod => {
    const dir = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/drawable');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../assets/offline_demo_icon.xml'), path.join(dir, 'offline_demo_icon.xml'));
    return mod;
  }]);
};
module.exports.hardenManifest = hardenManifest;
