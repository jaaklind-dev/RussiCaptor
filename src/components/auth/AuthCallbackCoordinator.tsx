import { useEffect } from "react";
import * as Linking from "expo-linking";
import { router } from "expo-router";

import { consumeAuthCallbackUrl, isAuthCallbackUrl } from "@/services/auth/AuthCallbackService";

let callbackInProgress = false;

export default function AuthCallbackCoordinator() {
  useEffect(() => {
    let mounted = true;

    async function handle(value: string | null): Promise<void> {
      if (!value || !isAuthCallbackUrl(value) || callbackInProgress) return;
      callbackInProgress = true;
      const result = await consumeAuthCallbackUrl(value);
      callbackInProgress = false;
      if (!mounted) return;
      if (result.ok) {
        router.replace({ pathname: "/auth/set-password", params: { flow: result.flow } });
      } else {
        router.replace({ pathname: "/auth/callback", params: { status: result.reason } });
      }
    }

    void Linking.getInitialURL().then(handle);
    const subscription = Linking.addEventListener("url", event => { void handle(event.url); });
    return () => { mounted = false; subscription.remove(); };
  }, []);

  return null;
}
