import "react-native-url-polyfill/auto";
import "expo-sqlite/localStorage/install";
import { AppState, Platform } from "react-native";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getReleaseConfigurationError } from "@/config/ReleaseConfig";
import { startRuntimeWorkTrace } from "@/services/runtime/persistence/RuntimeLeaseLifecycleTrace";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabasePublishableKey && !getReleaseConfigurationError()
);

const platformFetch = globalThis.fetch.bind(globalThis);
const tracedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.includes("/rest/v1/rpc/publish_runtime_checkpoint")) return platformFetch(input, init);
  const body = init?.body;
  const bodyBytes = typeof body === "string" ? body.length : 0;
  const endBodyEncode = startRuntimeWorkTrace("REMOTE_PUB_BODY_ENCODE", { bodyBytes });
  const request = platformFetch(input, init);
  endBodyEncode({ bodyBytes });
  const endNetwork = startRuntimeWorkTrace("REMOTE_PUB_NETWORK_WAIT", { bodyBytes });
  const response = await request;
  endNetwork({ bodyBytes, status: response.status });
  return response;
};

export const supabase: SupabaseClient | undefined = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: {
        storage: localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
      global: { fetch: tracedFetch },
    })
  : undefined;

/**
 * Realtime joins are authorized separately from REST requests.  On native
 * startup, make the restored authenticated session explicit before a channel
 * is created; the token itself never leaves the Supabase client.
 */
export async function synchronizeRealtimeAuthorization(): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token || data.session.user.is_anonymous) return false;
  await supabase.realtime.setAuth(data.session.access_token);
  return true;
}

// React Native does not manage Supabase Auth refresh from document visibility.
// Register one native lifecycle listener for this singleton client.
if (supabase && Platform.OS !== "web") {
  AppState.addEventListener("change", state => {
    if (state === "active") void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}
