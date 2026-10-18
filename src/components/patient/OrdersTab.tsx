import { Order } from "@/models/Order";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { getOrderStatusLabel } from "@/utils/status";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ImagingWorkflowSnapshot } from "@/models/ImagingWorkflow";
import { imagingStatusLabel } from "@/localization/et";
import { getImagingOrderReceiptVersion, imagingOrderPresentation,
  subscribeToImagingOrderReceipts } from "@/services/runtime/imaging/ImagingOrderPresentation";
import {
  getCanonicalExerciseSnapshot, getCanonicalExerciseSnapshotVersion, subscribeToCanonicalExerciseSnapshot,
} from "@/repositories/ExerciseSessionRepository";
import {
  getRuntimeReaderConvergenceVersion, subscribeToRuntimeReaderConvergence,
} from "@/services/runtime/persistence/RuntimeReaderConvergenceService";
import { runtimePatientCommandSubmissionReadiness } from "@/services/runtime/commands/RuntimePatientCommandService";

type Props = {
  orders: Order[];
  onPlaceOrder: (order: Order) => void | Promise<unknown>;
  readOnly?: boolean;
  imagingWorkflow?: ImagingWorkflowSnapshot;
  canPlaceImagingOrder?: (order: Order) => boolean;
};

export default function OrdersTab({ orders, onPlaceOrder, readOnly = false, imagingWorkflow, canPlaceImagingOrder }: Props) {
  useSyncExternalStore(subscribeToRuntimeReaderConvergence, getRuntimeReaderConvergenceVersion, getRuntimeReaderConvergenceVersion);
  useSyncExternalStore(subscribeToCanonicalExerciseSnapshot, getCanonicalExerciseSnapshotVersion, getCanonicalExerciseSnapshotVersion);
  useSyncExternalStore(subscribeToImagingOrderReceipts, getImagingOrderReceiptVersion, getImagingOrderReceiptVersion);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const latest = useRef({ orders, onPlaceOrder, readOnly, imagingWorkflow, canPlaceImagingOrder });
  useLayoutEffect(() => {
    latest.current = { orders, onPlaceOrder, readOnly, imagingWorkflow, canPlaceImagingOrder };
  }, [orders, onPlaceOrder, readOnly, imagingWorkflow, canPlaceImagingOrder]);
  const [pending, setPending] = useState(false);
  const imagingReadiness = (order: Order) => runtimePatientCommandSubmissionReadiness(
    order.exerciseId, getCanonicalExerciseSnapshot().simulationTimeSec, "IMAGING_ORDER");
  const placeOrder = async (order: Order) => {
    const current = latest.current;
    if (!mounted.current || current.readOnly || inFlight.current) return;
    if (order.category !== "imaging") {
      if (order.status !== "available") return;
    } else if (!canSubmitImaging(order)) return;
    inFlight.current = true;
    setPending(true);
    try {
      await current.onPlaceOrder(order);
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const canSubmitImaging = (order: Order) => {
    const current = latest.current;
    const selected = current.orders.find(item => item.id === order.id && item.exerciseId === order.exerciseId &&
      item.patientId === order.patientId && item.workflow.resultTargetId === order.workflow.resultTargetId);
    const presentation = imagingOrderPresentation(order, current.imagingWorkflow);
    return mounted.current && !current.readOnly && Boolean(selected) && presentation.available &&
      !presentation.pending && current.canPlaceImagingOrder?.(order) !== false && imagingReadiness(order).ready;
  };
  const requestOrder = (order: Order) => {
    if (order.category !== "imaging") { void placeOrder(order); return; }
    if (inFlight.current || !canSubmitImaging(order)) return;
    const offered = imagingOrderPresentation(order, latest.current.imagingWorkflow);
    if (!offered.repeat) { void placeOrder(order); return; }
    const intent = Object.freeze({ ...order, workflow: Object.freeze({ ...order.workflow }) });
    // Reserve the interaction while the dialog is open, not just during RPC.
    inFlight.current = true; setPending(true);
    let settled = false;
    const settle = (confirmed: boolean) => {
      if (settled) return;
      settled = true; inFlight.current = false;
      if (mounted.current) setPending(false);
      if (confirmed && canSubmitImaging(intent) &&
        imagingOrderPresentation(intent, latest.current.imagingWorkflow).latestCommandId === offered.latestCommandId) void placeOrder(intent);
    };
    Alert.alert("Korda pildiuuringut?", "Kordustellimus loob uue pildiuuringu taotluse. Varasem tulemus säilib.", [
      { text: "Loobu", style: "cancel", onPress: () => settle(false) },
      { text: "Telli kordusuuring", onPress: () => settle(true) },
    ], { cancelable: true, onDismiss: () => settle(false) });
  };
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Tellimused</Text>

      {readOnly && (
        <Text style={styles.readOnly}>Patsiendi käsitlus on lõpetatud. Uusi tellimusi lisada ei saa.</Text>
      )}

      {orders.length === 0 ? (
        <Text style={styles.empty}>Tellimusi ei ole.</Text>
      ) : (
        orders.map((order) => {
          const readiness = order.category === "imaging" ? imagingReadiness(order) : { ready: true };
          const imaging = order.category === "imaging" ? imagingOrderPresentation(order, imagingWorkflow) : undefined;
          const disabled = pending || !readiness.ready || Boolean(imaging &&
            (!imaging.available || imaging.pending || canPlaceImagingOrder?.(order) === false));
          const statusLabel = imaging ? !imaging.available ? "Ootan kinnitatud olekut"
            : imaging.status === "NOT_ORDERED" ? "Tellimata"
            : imaging.status === "PENDING" ? "Tellimus vastu võetud · ootan kinnitust"
              : imagingStatusLabel(imaging.status) : getOrderStatusLabel(order.status);
          return (
            <View key={order.id} style={styles.row}>
              <View>
                <Text style={styles.orderTitle}>{order.title}</Text>
                <Text style={styles.meta}>
                  {order.category} · {statusLabel}
                </Text>
                {(imaging || order.status === "available") && !readiness.ready && !readOnly && (
                  <Text accessibilityRole="alert" style={styles.readOnly}>
                    {readiness.reason ?? "Pilditellimus ootab õppuse andmete sünkroonimist. Tellimust ei saadetud."}
                  </Text>
                )}
                {imaging && !imaging.available && !readOnly && (
                  <Text accessibilityRole="alert" style={styles.readOnly}>Ootan pildiuuringute kinnitatud andmeid. Tellimust ei saadetud.</Text>
                )}
              </View>

              {(imaging || order.status === "available") && !readOnly && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${imaging?.repeat ? "Telli kordusuuring" : "Telli"} ${order.title}`}
                  disabled={disabled}
                  style={[styles.button, disabled && styles.disabled]}
                  onPress={() => requestOrder(order)}
                >
                  <Text style={styles.buttonText}>{imaging?.repeat ? "Telli kordusuuring" : "Telli"}</Text>
                </Pressable>
              )}
            </View>
          );
        })
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
  disabled: { opacity: 0.5 },
});
