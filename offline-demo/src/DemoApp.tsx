import { useState } from 'react';
import { BackHandler, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { SQLiteStorage } from 'expo-sqlite/kv-store';
import DemoApplication from './DemoApplication';
import { DEMO_DATABASE, DemoStore } from './DemoStore';
export function assertDemoIdentity(config: typeof Constants.expoConfig): void {
  const identity = config?.extra?.offlineDemo;
  if (config?.android?.package !== 'com.jaaklind.RussiCaptor.demo' || config.scheme || config?.updates?.enabled !== false ||
      identity?.mode !== 'offline-demo' || identity.schemaVersion !== 1 || identity.productionAccess !== false ||
      identity.distributable !== false || identity.publicationAuthorization !== 'NOT_GRANTED' ||
      !config.android.blockedPermissions?.includes('android.permission.INTERNET') || config.android.permissions?.length) {
    throw new Error('OFFLINE_DEMO_IDENTITY_INVALID');
  }
}
export default function DemoApp() {
  const [store] = useState(() => {
    try { assertDemoIdentity(Constants.expoConfig); return new DemoStore(new SQLiteStorage(DEMO_DATABASE)); }
    catch { return undefined; }
  });
  if (!store) return <View style={{ flex: 1, padding: 32, paddingTop: 64, backgroundColor: '#ffd166' }}>
    <Text>DEMO · Käivitamine peatatud</Text><Text>Demo identiteeti või kohalikku salvestust ei saanud kinnitada. Tootmisse ei minda üle.</Text>
  </View>;
  return <DemoApplication store={store} onExit={() => BackHandler.exitApp()} />;
}
