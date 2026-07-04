import { Link } from "expo-router";

import { Pressable, StyleSheet, Text, View } from "react-native";

export default function LoginScreen() {

  return (

    <View style={styles.container}>

      <Text style={styles.title}>RussiCaptor</Text>

      <Text style={styles.subtitle}>

        Botulism Exercise

      </Text>

      <Text style={styles.version}>

        Version 0.2

      </Text>

      <Link href="/dashboard" asChild>

        <Pressable style={styles.button}>

          <Text style={styles.buttonText}>Login</Text>

        </Pressable>

      </Link>

    </View>

  );

}

const styles = StyleSheet.create({

  container: {

    flex: 1,

    backgroundColor: "#ffffff",

    justifyContent: "center",

    alignItems: "center",

    padding: 24,

  },

  title: {

    fontSize: 42,

    fontWeight: "bold",

    marginBottom: 12,

  },

  subtitle: {

    fontSize: 22,

    color: "#555",

    marginBottom: 6,

  },

  version: {

    fontSize: 16,

    color: "#888",

    marginBottom: 50,

  },

  button: {

    backgroundColor: "#005BBB",

    paddingVertical: 16,

    paddingHorizontal: 50,

    borderRadius: 12,

  },

  buttonText: {

    color: "#ffffff",

    fontWeight: "bold",

    fontSize: 18,

  },

});