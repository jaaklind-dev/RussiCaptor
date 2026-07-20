import { Order } from "@/models/Order";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getOrderStatusLabel } from "@/utils/status";
type Props = {
  orders: Order[];
  onPlaceOrder: (order: Order) => void;
  readOnly?: boolean;
};

export default function OrdersTab({ orders, onPlaceOrder, readOnly = false }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Tellimused</Text>

      {readOnly && (
        <Text style={styles.readOnly}>Patsiendi käsitlus on lõpetatud. Uusi tellimusi lisada ei saa.</Text>
      )}

      {orders.length === 0 ? (
        <Text style={styles.empty}>Tellimusi ei ole.</Text>
      ) : (
        orders.map((order) => (
          <View key={order.id} style={styles.row}>
            <View>
              <Text style={styles.orderTitle}>{order.title}</Text>
             <Text style={styles.meta}>
               {order.category} · {getOrderStatusLabel(order.status)}
             </Text>
            </View>

            {order.status === "available" && !readOnly && (
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
  readOnly: {
    color: "#b42318",
    marginBottom: 14,
    lineHeight: 21,
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
