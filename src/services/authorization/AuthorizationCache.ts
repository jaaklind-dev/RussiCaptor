import * as FileSystem from "expo-file-system/legacy";
import type { Principal } from "@/models/authorization/Authorization";
import { deepFreeze } from "@/utils/immutable";

const cacheUri = `${FileSystem.documentDirectory}russicaptor-authorization-cache.json`;
export type AuthorizationCache = { load(userId: string): Promise<Principal | undefined>; store(principal: Principal): Promise<void>; clear(): Promise<void> };

export class FileAuthorizationCache implements AuthorizationCache {
  async load(userId: string): Promise<Principal | undefined> {
    try {
      const info = await FileSystem.getInfoAsync(cacheUri); if (!info.exists) return undefined;
      const value = JSON.parse(await FileSystem.readAsStringAsync(cacheUri)) as Principal;
      if (value.userId !== userId) return undefined;
      return deepFreeze({ ...value, authorizationFreshness: new Date(value.authorizationProvenance.expiresAt).getTime() > Date.now() ? "VERIFIED_CACHED" : "STALE" });
    } catch { return undefined; }
  }
  async store(principal: Principal): Promise<void> { await FileSystem.writeAsStringAsync(cacheUri, JSON.stringify(principal)); }
  async clear(): Promise<void> { const info = await FileSystem.getInfoAsync(cacheUri); if (info.exists) await FileSystem.deleteAsync(cacheUri, { idempotent: true }); }
}
