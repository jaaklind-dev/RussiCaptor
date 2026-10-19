import { useState } from 'react';
import { BackHandler, Pressable, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { SQLiteStorage } from 'expo-sqlite/kv-store';
import DemoRuntimeApplication from './runtime/DemoRuntimeApplication';
import { DemoSessionStore } from './runtime/DemoSession';
import { DEMO_DATABASE } from './DemoStore';
import { DemoUpgradeNotice } from './DemoUpgrade';
import DemoBuilderEntry from './builder/DemoBuilderEntry';
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
  const [builderOpen, setBuilderOpen] = useState(false);
  const [bootstrap] = useState(() => {
    try {
      assertDemoIdentity(Constants.expoConfig);
      const storage = new SQLiteStorage(DEMO_DATABASE);
      return { store: new DemoSessionStore(storage), upgrade: new DemoUpgradeNotice(storage) };
    }
    catch { return undefined; }
  });
  const [upgradeState, setUpgradeState] = useState(() => bootstrap?.upgrade.inspect());
  if (!bootstrap) return <View style={{ flex: 1, padding: 32, paddingTop: 64, backgroundColor: '#ffd166' }}>
    <Text>DEMO · Käivitamine peatatud</Text><Text>Demo identiteeti või kohalikku salvestust ei saanud kinnitada. Tootmisse ei minda üle.</Text>
  </View>;
  if (upgradeState !== 'CLEAR') return <View style={{ flex: 1, padding: 32, paddingTop: 64, gap: 20, backgroundColor: '#ffd166' }}>
    <Text>DEMO · Versiooniüleminek</Text>
    {upgradeState === 'UNAVAILABLE' ? <>
      <Text>Üleminekuteate salvestust ei saanud kinnitada. Andmeid ei kustutata. Proovi kontrolli uuesti.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Kontrolli demo üleminekut uuesti" onPress={() => setUpgradeState(bootstrap.upgrade.inspect())}><Text>Kontrolli uuesti</Text></Pressable>
    </> : <>
      <Text>{upgradeState === 'LEGACY_PRESENT' ? 'Leiti varasema demo 0.1.0 kohalik olek.' : 'Leiti varasema demo salvestus, mille vormingut ei saanud kinnitada.'}</Text>
      <Text>Varasema demo avamiste loendurit ei kanta simulatsiooni üle. Kui simulatsiooniseanssi veel pole, alustab uus demo algseisust. Olemasolev kehtiv 0.2.0 seanss säilib. Varasemaid andmeid ei kustutata ega väideta, et need migreeriti.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Selge, jätka demoga" onPress={() => setUpgradeState(bootstrap.upgrade.acknowledge())}><Text>Selge, jätka demoga</Text></Pressable>
    </>}
    <Pressable accessibilityRole="button" accessibilityLabel="Välju demost" onPress={() => BackHandler.exitApp()}><Text>Välju demost</Text></Pressable>
  </View>;
  if (builderOpen) return <DemoBuilderEntry onExit={() => setBuilderOpen(false)}/>;
  return <DemoRuntimeApplication store={bootstrap.store} onExit={() => BackHandler.exitApp()} onBuilder={() => setBuilderOpen(true)} />;
}
