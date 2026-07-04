import { Image, StyleSheet, View } from "react-native";

export default function AppHeader() {

  return (

    <View style={styles.header}>

      <Image

        source={require("@/assets/logo.png")}

        style={styles.logo}

        resizeMode="contain"

      />

    </View>

  );

}

const styles = StyleSheet.create({

  header: {

    position: "absolute",

    top: 36,

    left: 20,

    zIndex: 10,

  },

  logo: {

    width: 95,

    height: 65,

  },

});