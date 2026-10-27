import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SQLiteStorage } from 'expo-sqlite/kv-store';
import { BUILDER_DATABASE, DemoBuilderStore } from './DemoBuilderStore';
import DemoBuilderApplication from './DemoBuilderApplication';
export default function DemoBuilderEntry({ onExit }: { onExit: () => void }) {
  // Lazy and instance-owned: opening Builder never opens canonical or runtime storage.
  const [store] = useState(() => { try { return new DemoBuilderStore(new SQLiteStorage(BUILDER_DATABASE)); } catch { return undefined; } });
  if (!store) return <View style={{ padding: 32, paddingTop: 64 }}><Text>DEMO · Builderi salvestus pole saadaval. Tootmisse ei minda üle.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Tagasi demosse" style={{ minHeight: 48, padding: 16 }} onPress={onExit}><Text>Tagasi demosse</Text></Pressable></View>;
  return <DemoBuilderApplication store={store} onExit={onExit}/>;
}
