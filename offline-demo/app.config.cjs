const { assertOfflineEnvironment, PACKAGE_ID } = require('./isolation-policy.cjs');
module.exports = () => {
  assertOfflineEnvironment(process.env);
  return {
    name: 'RussiCaptor DEMO', slug: 'russicaptor-offline-demo', version: '0.1.0',
    platforms: ['android'], orientation: 'portrait', userInterfaceStyle: 'light',
    updates: { enabled: false },
    android: { package: PACKAGE_ID, versionCode: 1, allowBackup: false, permissions: [],
      blockedPermissions: ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO', 'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.READ_MEDIA_IMAGES'] },
    plugins: ['expo-sqlite', './plugins/withOfflineDemo.cjs'],
    extra: { offlineDemo: { mode: 'offline-demo', schemaVersion: 1, productionAccess: false,
      distributable: false, publicationAuthorization: 'NOT_GRANTED' } },
  };
};
