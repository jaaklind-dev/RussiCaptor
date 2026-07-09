import { Order } from "@/models/Order";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  orders: Order[];
  onPlaceOrder: (order: Order) => void;
};

export default function OrdersTab({ orders, onPlaceOrder }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Tellimused</Text>

      {orders.length === 0 ? (
        <Text style={styles.empty}>Tellimusi ei ole.</Text>
      ) : (
        orders.map((order) => (
          <View key={order.id} style={styles.row}>
            <View>
              <Text style={styles.orderTitle}>{order.title}</Text>
              <Text style={styles.meta}>{order.category} · {order.status}</Text>
            </View>

            {order.status === "available" && (
              <Pressable
                style={styles.button}
                onPress={() => onPlaceOrder(order)}
              >
                <Text style={styles.buttonText}>Telli</Text>
              </Pressable>
            )}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#f2f4f7",
    borderRadius: 16,
    padding: 18,
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 14,
  },
  empty: {
    color: "#666",
    fontStyle: "italic",
  },
  row: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d0d5dd",
    padding: 12,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  orderTitle: {
    fontSize: 17,
    fontWeight: "bold",
  },
  meta: {
    marginTop: 4,
    color: "#666",
  },
  button: {
    backgroundColor: "#005BBB",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "bold",
  },
});