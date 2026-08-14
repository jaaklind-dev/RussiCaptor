import * as FileSystem from "expo-file-system/legacy";

const identityUri = `${FileSystem.documentDirectory}russicaptor-runtime-writer-id.txt`;
let cached: string | undefined;

export async function getRuntimeWriterInstanceId(): Promise<string> {
  if (cached) return cached;
  const info = await FileSystem.getInfoAsync(identityUri);
  if (info.exists) {
    const value = (await FileSystem.readAsStringAsync(identityUri)).trim();
    if (value) return (cached = value);
  }
  // Nonclinical installation identity. Persisted once; excluded from Runtime,
  // replay and checkpoint integrity semantics.
  cached = `runtime-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  await FileSystem.writeAsStringAsync(identityUri, cached);
  return cached;
}
