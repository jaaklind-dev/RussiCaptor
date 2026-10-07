import type { PropsWithChildren } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import type { ExconRouteReadiness } from "@/services/ui/ExconRouteReadinessService";

export function ExconRouteReadinessBoundary({
  readiness,
  children,
}: PropsWithChildren<{ readiness: ExconRouteReadiness }>) {
  if (readiness.state === "AUTHORIZED") return children;
  const pending = readiness.state === "PENDING";
  return <View
    accessibilityLabel={pending ? "EXCON-i ligipääsu kontrollimine" : "EXCON-i ligipääs puudub"}
    style={styles.container}
    testID={pending ? "excon-route-readiness-pending" : "excon-route-readiness-denied"}
  >
    {pending && <ActivityIndicator size="large" color="#005BBB" />}
    <Text style={styles.title}>{pending ? "Ligipääsu kontrollimine…" : "Ligipääs puudub"}</Text>
    <Text style={styles.message}>{pending
      ? readiness.reason === "CURRENT_EXERCISE"
        ? "Õppuse andmete laadimine…"
        : "Kontrollin operaatori õigusi…"
      : "Suuname sind lubatud vaatesse…"}</Text>
  </View>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
    backgroundColor: "#F6F8FB",
  },
  title: { color: "#101828", fontSize: 22, fontWeight: "800", textAlign: "center" },
  message: { color: "#475467", fontSize: 16, textAlign: "center" },
});
