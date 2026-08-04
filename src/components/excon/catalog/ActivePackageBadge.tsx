import { StyleSheet, Text } from "react-native";

export function ActivePackageBadge() {
  return <Text style={styles.badge}>ACTIVE</Text>;
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start", backgroundColor: "#e3fcef", color: "#006644", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 11, fontWeight: "900" },
});
