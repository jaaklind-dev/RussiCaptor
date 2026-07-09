import { Image, StyleSheet, View } from "react-native";

type Props = {
  source: any;
};

export default function ImageViewer({ source }: Props) {
  return (
    <View style={styles.container}>
      <Image
        source={source}
        resizeMode="contain"
        style={styles.image}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#000",
  },

  image: {
    width: "100%",
    height: 320,
  },
});