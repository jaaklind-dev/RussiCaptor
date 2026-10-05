import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { LaboratoryWorkflowSnapshot, NarvaLabPackageId } from
  "@/models/LaboratoryWorkflow";
import { traceLaboratoryAction } from "./LaboratoryActionDiagnostics";
import { buildLaboratoryResultPresentation } from "./LaboratoryResultPresentation";
import type { LaboratoryPresentedGroup, LaboratoryPresentedRow } from "./LaboratoryResultPresentation";

type Outcome = Readonly<{ ok: boolean; message: string }>;
type CommandReadiness = Readonly<{ ready: boolean; reason?: string }>;
type Props = Readonly<{
  workflow?: LaboratoryWorkflowSnapshot;
  packageId?: NarvaLabPackageId;
  workflowScopeKey?: string;
  projectionRevision?: number;
  projectionReady?: boolean;
  commandReadiness?: CommandReadiness;
  readOnly?: boolean;
  onOrder: () => Promise<Outcome>;
  onCollect: (orderId: string) => Promise<Outcome>;
}>;

const COMMAND_READY: CommandReadiness = Object.freeze({ ready: true });

const packageLabel = (packageId: NarvaLabPackageId) => packageId === "NARVA_IRO_ASTRUP"
  ? "Telli Astrup" : "Telli POLÜTRAUMA analüüsid";
const statusLabel: Readonly<Record<string, string>> = Object.freeze({
  ORDERED: "ORDERED", COLLECTED: "COLLECTED / PROCESSING", PROCESSING: "COLLECTED / PROCESSING",
  PARTIALLY_RESULTED: "PARTIALLY_RESULTED", RESULTED: "RESULTED",
});

const abnormalLabel = (row: LaboratoryPresentedRow) => row.abnormalFlag === "HIGH" ? "KÕRGE"
  : row.abnormalFlag === "LOW" ? "MADAL" : row.abnormalFlag === "NORMAL" ? "Normis" : undefined;
const referenceRangeLabel = (value: string) => value.replace(/female/gi, "naine")
  .replace(/male/gi, "mees").replace(/adult/gi, "täiskasvanu");

const rowValueAccessibilityLabel = (row: LaboratoryPresentedRow): string => {
  if (row.kind === "NOT_APPLICABLE") return `${row.name}: ei kohaldu, ei ole negatiivne tulemus`;
  if (row.kind === "SOURCE_AMBIGUOUS") return `${row.name}: tulemus puudub, allikas ebaselge`;
  if (row.kind === "PENDING") return `${row.name}: tulemus ootel`;
  if (row.kind === "MISSING") return `${row.name}: tulemus puudub`;
  const measurement = `${row.valueText ?? ""}${row.unit ? ` ${row.unit}` : ""}`;
  const flag = abnormalLabel(row);
  return `${row.name}: ${measurement}${flag ? `, ${flag}` : ""}`;
};

const LaboratoryResultRow = memo(function LaboratoryResultRow(
  { row }: Readonly<{ row: LaboratoryPresentedRow }>,
) {
  const flag = abnormalLabel(row);
  const abnormal = row.abnormalFlag === "HIGH" || row.abnormalFlag === "LOW";
  return (
    <View testID={`laboratory-result-${row.analyteId}`} accessibilityLabel={rowValueAccessibilityLabel(row)}
      style={[styles.resultRow,
      row.abnormalFlag === "HIGH" && styles.resultHigh,
      row.abnormalFlag === "LOW" && styles.resultLow]}>
      <View style={styles.resultNameColumn}>
        <Text style={styles.resultName}>{row.name}</Text>
        {row.referenceRange && <Text style={styles.reference}>Võrdlus: {referenceRangeLabel(row.referenceRange)}</Text>}
        {row.sourceMetadata && !row.referenceRange && row.kind !== "QUALITATIVE" &&
          <Text style={styles.reference}>Allikas: {row.sourceMetadata}</Text>}
      </View>
      <View style={styles.resultValueColumn}>
        {row.state === "RESULT" ? <>
          <View style={[styles.measurement, row.kind === "QUALITATIVE" && styles.qualitativeMeasurement]}>
            <Text style={[styles.resultValue, row.kind === "QUALITATIVE" && styles.qualitativeValue,
              row.abnormalFlag === "HIGH" && styles.resultValueHigh,
              row.abnormalFlag === "LOW" && styles.resultValueLow]}>{row.valueText}</Text>
            {row.unit && <Text style={styles.resultUnit}>{row.unit}</Text>}
          </View>
          {abnormal && flag && <Text accessibilityLabel={`Tulemus ${flag}`} style={[styles.flag,
            row.abnormalFlag === "HIGH" && styles.flagHigh,
            row.abnormalFlag === "LOW" && styles.flagLow]}>{flag}</Text>}
        </> : row.state === "NOT_APPLICABLE"
          ? <View style={styles.semanticValue}><Text style={styles.notApplicable}>Ei kohaldu</Text>
            <Text style={styles.semanticHint}>Pole negatiivne tulemus</Text></View>
          : row.kind === "SOURCE_AMBIGUOUS"
            ? <View style={styles.semanticValue}><Text style={styles.ambiguousValue}>Allikas ebaselge</Text>
              <Text style={styles.semanticHint}>Tulemust ei kuvata</Text></View>
            : row.state === "PENDING"
              ? <Text style={styles.pendingValue}>Tulemus ootel</Text>
            : <Text style={styles.missingValue}>Tulemus puudub</Text>}
      </View>
    </View>
  );
});

export function defaultLaboratoryGroupExpanded(group: LaboratoryPresentedGroup): boolean {
  return group.type === "ASTRUP" && group.status !== "PROCESSING";
}

const LaboratoryResultGroupSection = memo(function LaboratoryResultGroupSection(
  { group }: Readonly<{ group: LaboratoryPresentedGroup }>,
) {
  const [expanded, setExpanded] = useState(() => defaultLaboratoryGroupExpanded(group));
  const pending = group.status === "PROCESSING";
  const abnormalCount = group.rows.filter(row => row.abnormalFlag === "HIGH" || row.abnormalFlag === "LOW").length;
  const summary = pending ? "Tulemused töötlemisel" : `${group.resultCount} tulemust${abnormalCount
    ? ` · ${abnormalCount} kõrvalekallet` : ""}${group.unresolvedCount
    ? ` · ${group.unresolvedCount} lahendamata` : ""}`;
  return (
    <View testID={`laboratory-group-section-${group.type}`} style={styles.group}>
      <Pressable testID={`laboratory-group-toggle-${group.type}`} accessibilityRole="button"
        accessibilityLabel={`${group.title}, ${group.statusLabel}, ${expanded ? "sulge" : "ava"}`}
        accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)}
        style={styles.groupHeader}>
        <View style={styles.groupHeadingColumn}>
          <Text style={styles.groupTitle}>{group.title}</Text>
          <Text style={styles.groupSummary}>{summary}</Text>
        </View>
        <View style={styles.groupStatusColumn}>
          <Text style={[styles.groupStatus, pending && styles.groupStatusPending]}>{group.statusLabel}</Text>
          <Text style={styles.groupChevron}>{expanded ? "▲" : "▼"}</Text>
        </View>
      </Pressable>
      {expanded && <View testID={`laboratory-group-content-${group.type}`}>
        <Text style={styles.groupMeta}>Valmib T+{group.availableAtSimulationTimeSec}s
          {group.generatedAtSimulationTimeSec !== undefined
            ? ` · avaldatud T+${group.generatedAtSimulationTimeSec}s` : ""}
          </Text>
        {pending
          ? <Text style={styles.processingMessage}>Tulemused on töötlemisel. Väärtusi ei ole veel avaldatud.</Text>
          : group.rows.map(row => <LaboratoryResultRow key={row.key} row={row} />)}
      </View>}
    </View>
  );
});

type StableActionProps = Readonly<{
  accessibilityLabel: string;
  testID: string;
  label: string;
  intent: LaboratoryActionIntent;
  disabled: boolean;
  controlInstanceId: string;
  semanticActionId: string;
  projectionRevision: number;
  onIntentStart: (intent: LaboratoryActionIntent) => void;
  onIntentRelease: (intent: LaboratoryActionIntent) => void;
  onDispatch: (fallback: LaboratoryActionIntent) => void;
}>;

function StableLaboratoryAction({ accessibilityLabel, testID, label, intent, disabled,
  controlInstanceId, semanticActionId, projectionRevision,
  onIntentStart, onIntentRelease, onDispatch }: StableActionProps) {
  const detail = useMemo(() => Object.freeze({ controlInstanceId, semanticActionId,
    intent: intent.kind, projectionRevision, disabled }),
  [controlInstanceId, disabled, intent.kind, projectionRevision, semanticActionId]);
  const [mountDetail] = useState(detail);
  useEffect(() => {
    traceLaboratoryAction("LAB_ACTION_MOUNT", mountDetail);
    return () => traceLaboratoryAction("LAB_ACTION_UNMOUNT", mountDetail);
  }, [controlInstanceId, mountDetail]); // Native control identity, not projection state, owns this trace.
  useEffect(() => { traceLaboratoryAction("LAB_ACTION_RENDER", detail); }, [detail]);
  const handlePressIn = useCallback(() => {
    traceLaboratoryAction("LAB_ACTION_PRESS_IN", detail);
    onIntentStart(intent);
  }, [detail, intent, onIntentStart]);
  const handlePressOut = useCallback(() => {
    traceLaboratoryAction("LAB_ACTION_PRESS_OUT", detail);
    onIntentRelease(intent);
  }, [detail, intent, onIntentRelease]);
  const handlePress = useCallback(() => {
    traceLaboratoryAction("LAB_ACTION_PRESS", detail);
    onDispatch(intent);
  }, [detail, intent, onDispatch]);
  return (
    <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button"
      accessibilityState={{ busy: disabled, disabled }} disabled={disabled}
      testID={testID} style={[styles.primary, disabled && styles.disabled]}
      onPressIn={handlePressIn} onPressOut={handlePressOut} onPress={handlePress}
      onResponderGrant={() => traceLaboratoryAction("LAB_ACTION_RESPONDER_GRANT", detail)}
      onResponderTerminate={() => traceLaboratoryAction("LAB_ACTION_RESPONDER_TERMINATE", detail)}>
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

type LaboratoryActionIntent = Readonly<
  { kind: "LAB_ORDER" } | { kind: "LAB_COLLECT"; orderId: string }
>;

type LaboratoryActionValidityToken = Readonly<{
  intent: LaboratoryActionIntent;
  scopeKey: string;
  projectionRevision: number;
  pendingOrderId?: string;
  sampledOrderIds: ReadonlySet<string>;
}>;

const intentKey = (intent: LaboratoryActionIntent) => intent.kind === "LAB_ORDER"
  ? intent.kind : `${intent.kind}:${intent.orderId}`;

const statusRank: Readonly<Record<string, number>> = Object.freeze({
  ORDERED: 0, COLLECTED: 1, PROCESSING: 2, PARTIALLY_RESULTED: 3, RESULTED: 4,
});

function projectionDoesNotRegress(
  previous: LaboratoryWorkflowSnapshot | undefined,
  candidate: LaboratoryWorkflowSnapshot | undefined,
): boolean {
  if (!previous) return true;
  if (!candidate) return false;
  if (previous.terminalFencedAtSimulationTimeSec !== undefined &&
    candidate.terminalFencedAtSimulationTimeSec === undefined) return false;
  if (candidate.orders.length < previous.orders.length || candidate.samples.length < previous.samples.length ||
    candidate.resultGroups.length < previous.resultGroups.length) return false;
  const candidateOrders = new Map(candidate.orders.map(item => [item.orderId, item]));
  if (previous.orders.some(item => {
    const next = candidateOrders.get(item.orderId);
    return !next || (statusRank[next.status] ?? -1) < (statusRank[item.status] ?? -1);
  })) return false;
  const candidateSamples = new Map(candidate.samples.map(item => [item.sampleId, item]));
  if (previous.samples.some(item => candidateSamples.get(item.sampleId)?.orderId !== item.orderId)) return false;
  const candidateGroups = new Map(candidate.resultGroups.map(item => [item.resultGroupId, item]));
  return !previous.resultGroups.some(item => {
    const next = candidateGroups.get(item.resultGroupId);
    return !next || (statusRank[next.status] ?? -1) < (statusRank[item.status] ?? -1);
  });
}

export default function LaboratoryWorkflowCard({ workflow, packageId, workflowScopeKey = "default",
  projectionRevision = 0, projectionReady = true, commandReadiness = COMMAND_READY,
  readOnly = false, onOrder, onCollect }: Props) {
  const [feedback, setFeedback] = useState<string>();
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [collectSubmitting, setCollectSubmitting] = useState(false);
  const [committingIntent, setCommittingIntent] = useState<LaboratoryActionIntent>();
  const latchedAction = useRef<LaboratoryActionValidityToken | undefined>(undefined);
  const orderPending = useRef(false);
  const collectPendingOrderId = useRef<string | undefined>(undefined);
  const [controlInstanceId] = useState(() => `LAB_ACTION:${workflowScopeKey}`);
  const onOrderRef = useRef(onOrder);
  const onCollectRef = useRef(onCollect);
  const [projection, setProjection] = useState<Readonly<{ scopeKey: string; revision: number;
    workflow?: LaboratoryWorkflowSnapshot }>>(() => ({ scopeKey: workflowScopeKey,
    revision: projectionReady ? projectionRevision : -1, ...(projectionReady ? { workflow } : {}) }));
  useEffect(() => { onOrderRef.current = onOrder; }, [onOrder]);
  useEffect(() => { onCollectRef.current = onCollect; }, [onCollect]);
  if (projectionReady && workflowScopeKey !== projection.scopeKey) {
    setProjection({ scopeKey: workflowScopeKey, revision: projectionRevision, workflow });
  } else if (projectionReady && projectionRevision >= projection.revision && projection.workflow !== workflow &&
    projectionDoesNotRegress(projection.workflow, workflow)) {
    setProjection({ scopeKey: workflowScopeKey, revision: projectionRevision, workflow });
  }
  const displayedWorkflow = projection.workflow;
  const orders = useMemo(() => displayedWorkflow?.orders ?? [], [displayedWorkflow]);
  const samples = useMemo(() => displayedWorkflow?.samples ?? [], [displayedWorkflow]);
  const groups = useMemo(() => displayedWorkflow?.resultGroups ?? [], [displayedWorkflow]);
  const presentedGroups = useMemo(() => packageId
    ? buildLaboratoryResultPresentation(groups, packageId) : [], [groups, packageId]);
  const pendingOrder = [...orders].reverse().find(item => item.status === "ORDERED" &&
    !samples.some(sample => sample.orderId === item.orderId));
  const actionState = useRef<Readonly<{ readOnly: boolean; projectionReady: boolean; commandReady: boolean;
    commandReadinessReason?: string; scopeKey: string;
    projectionRevision: number;
    pendingOrderId?: string; sampledOrderIds: ReadonlySet<string> }>>({
    readOnly, projectionReady: projection.revision >= 0, commandReady: commandReadiness.ready,
    ...(commandReadiness.reason ? { commandReadinessReason: commandReadiness.reason } : {}),
    scopeKey: projection.scopeKey,
    projectionRevision: projection.revision,
    ...(pendingOrder ? { pendingOrderId: pendingOrder.orderId } : {}),
    sampledOrderIds: new Set(samples.map(item => item.orderId)),
  });
  useEffect(() => {
    actionState.current = { readOnly, projectionReady: projection.revision >= 0,
      commandReady: commandReadiness.ready,
      ...(commandReadiness.reason ? { commandReadinessReason: commandReadiness.reason } : {}),
      scopeKey: projection.scopeKey,
      projectionRevision: projection.revision,
      ...(pendingOrder ? { pendingOrderId: pendingOrder.orderId } : {}),
      sampledOrderIds: new Set(samples.map(item => item.orderId)) };
  }, [commandReadiness.ready, commandReadiness.reason, pendingOrder, projection.scopeKey,
    projection.revision, readOnly, samples]);

  useEffect(() => {
    if (orderPending.current && pendingOrder) {
      orderPending.current = false;
      setOrderSubmitting(false);
    }
    const collectOrderId = collectPendingOrderId.current;
    if (collectOrderId && samples.some(item => item.orderId === collectOrderId)) {
      collectPendingOrderId.current = undefined;
      setCollectSubmitting(false);
    }
  }, [pendingOrder, samples]);

  const onIntentStart = useCallback((intent: LaboratoryActionIntent) => {
    if ((intent.kind === "LAB_ORDER" && orderPending.current) ||
      (intent.kind === "LAB_COLLECT" && collectPendingOrderId.current)) return;
    const current = actionState.current;
    if (current.readOnly || !current.projectionReady || !current.commandReady) return;
    const token: LaboratoryActionValidityToken = Object.freeze({ intent,
      scopeKey: current.scopeKey, projectionRevision: current.projectionRevision,
      ...(current.pendingOrderId ? { pendingOrderId: current.pendingOrderId } : {}),
      sampledOrderIds: new Set(current.sampledOrderIds) });
    latchedAction.current = token;
    setCommittingIntent(intent);
  }, []);
  const onIntentRelease = useCallback((intent: LaboratoryActionIntent) => {
    const key = intentKey(intent);
    setTimeout(() => {
      if (latchedAction.current && intentKey(latchedAction.current.intent) === key) {
        latchedAction.current = undefined;
        setCommittingIntent(undefined);
      }
    }, 0);
  }, []);
  const onDispatch = useCallback((fallback: LaboratoryActionIntent) => {
    const current = actionState.current;
    const token = latchedAction.current ?? (current.projectionReady ? Object.freeze({ intent: fallback,
      scopeKey: current.scopeKey, projectionRevision: current.projectionRevision,
      ...(current.pendingOrderId ? { pendingOrderId: current.pendingOrderId } : {}),
      sampledOrderIds: new Set(current.sampledOrderIds) }) : undefined);
    latchedAction.current = undefined;
    setCommittingIntent(undefined);
    if (!token || current.readOnly || current.scopeKey !== token.scopeKey) {
      setFeedback("Laboritoiming aegus või andmed sünkroniseeruvad. Proovi uuesti.");
      return;
    }
    if (!current.commandReady) {
      setFeedback(current.commandReadinessReason ?? "Patsiendi andmeid sünkroniseeritakse. Proovi uuesti.");
      return;
    }
    const intent = token.intent;
    const newerProjection = current.projectionRevision > token.projectionRevision;
    if (intent.kind === "LAB_ORDER") {
      if (orderPending.current) return;
      if (newerProjection && current.pendingOrderId) {
        setFeedback("Laboritellimus on juba autoritatiivselt olemas.");
        return;
      }
      orderPending.current = true;
      setOrderSubmitting(true);
      setFeedback("Käsk ootab serveri kinnitust…");
      void onOrderRef.current().then(result => {
        setFeedback(result.message);
        if (!result.ok) { orderPending.current = false; setOrderSubmitting(false); }
      }).catch(() => {
        setFeedback("Laborikäsku ei saanud tööjärjekorda saata.");
        orderPending.current = false;
        setOrderSubmitting(false);
      });
      return;
    }
    if (collectPendingOrderId.current) return;
    if (newerProjection && (current.pendingOrderId !== intent.orderId ||
      current.sampledOrderIds.has(intent.orderId))) {
      setFeedback("Proovivõtu olek muutus. Toiming katkestati.");
      return;
    }
    collectPendingOrderId.current = intent.orderId;
    setCollectSubmitting(true);
    setFeedback("Käsk ootab serveri kinnitust…");
    void onCollectRef.current(intent.orderId).then(result => {
      setFeedback(result.message);
      if (!result.ok) { collectPendingOrderId.current = undefined; setCollectSubmitting(false); }
    }).catch(() => {
      setFeedback("Laborikäsku ei saanud tööjärjekorda saata.");
      collectPendingOrderId.current = undefined;
      setCollectSubmitting(false);
    });
  }, []);
  const presentedIntent = useMemo<LaboratoryActionIntent>(() => committingIntent ?? (pendingOrder
    ? Object.freeze({ kind: "LAB_COLLECT" as const, orderId: pendingOrder.orderId })
    : Object.freeze({ kind: "LAB_ORDER" as const })), [committingIntent, pendingOrder]);
  if (!packageId) return null;
  // Once a coherent projection has existed, transient reader synchronization must not
  // remove or disable the native touch target. The single slot survives semantic changes;
  // LAB-G18/G19 latch and validate the action that began the gesture.
  const showAction = !readOnly && (projection.revision >= 0 || projectionReady || committingIntent !== undefined);
  const isOrder = presentedIntent.kind === "LAB_ORDER";
  const actionSubmitting = isOrder ? orderSubmitting : collectSubmitting;
  const actionDisabled = actionSubmitting || (!commandReadiness.ready && committingIntent === undefined);
  const actionLabel = !commandReadiness.ready && committingIntent === undefined
    ? "Sünkroniseerimine…" : isOrder ? packageLabel(packageId) : "Kogu proov";
  const actionAccessibilityLabel = isOrder ? packageLabel(packageId) : "Kogu laboriproov";
  const actionTestId = isOrder ? "laboratory-order-action" : "laboratory-collect-action";
  const semanticActionId = isOrder ? `${controlInstanceId}:LAB_ORDER`
    : `${controlInstanceId}:LAB_COLLECT:${presentedIntent.orderId}`;

  return (
    <View style={styles.card} accessibilityLabel="Autoritatiivne labori töövoog">
      <Text style={styles.title}>Labori töövoog</Text>
      {showAction && <StableLaboratoryAction accessibilityLabel={actionAccessibilityLabel}
        testID={actionTestId} label={actionLabel} intent={presentedIntent} disabled={actionDisabled}
        controlInstanceId={controlInstanceId} semanticActionId={semanticActionId}
        projectionRevision={projection.revision} onIntentStart={onIntentStart}
        onIntentRelease={onIntentRelease} onDispatch={onDispatch} />}
      {!readOnly && (!projectionReady || !commandReadiness.ready) &&
        <Text testID="laboratory-command-readiness" pointerEvents="none" style={styles.readOnly}>
          Labori töövoog sünkroniseerub…
        </Text>}
      {readOnly && <Text style={styles.readOnly}>Uue labori tellimine ja proovivõtt ei ole lubatud.</Text>}
      {feedback && <Text accessibilityRole="alert" pointerEvents="none" style={styles.feedback}>{feedback}</Text>}
      {orders.length === 0 && <Text style={styles.empty}>Laboritellimusi ei ole.</Text>}
      {orders.map(order => {
        const sample = samples.find(item => item.orderId === order.orderId);
        const resultGroups = sample
          ? presentedGroups.filter(item => item.sampleId === sample.sampleId) : [];
        return (
          <View key={order.orderId} style={styles.order}>
            <Text style={styles.orderTitle}>{order.packageId === "NARVA_IRO_ASTRUP" ? "Astrup" : "POLÜTRAUMA"}</Text>
            <Text style={styles.meta}>{statusLabel[order.status] ?? "Tundmatu olek"} · T+{order.orderedAtSimulationTimeSec}s</Text>
            {sample && <Text style={styles.meta}>Proov kogutud T+{sample.sampledAtSimulationTimeSec}s</Text>}
            {resultGroups.map(group => <LaboratoryResultGroupSection key={group.key} group={group} />)}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#eef4ff", borderRadius: 16, padding: 18, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: "bold", marginBottom: 12 },
  primary: { alignSelf: "flex-start", backgroundColor: "#005BBB", borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12 },
  disabled: { opacity: 0.55 },
  primaryText: { color: "#fff", fontWeight: "bold" },
  readOnly: { color: "#b42318", marginBottom: 10 },
  feedback: { color: "#344054", marginBottom: 10 },
  empty: { color: "#667085", fontStyle: "italic" },
  order: { backgroundColor: "#fff", borderColor: "#b2ccff", borderWidth: 1, borderRadius: 10,
    padding: 12, marginTop: 10 },
  orderTitle: { fontSize: 17, fontWeight: "bold" },
  meta: { color: "#475467", marginTop: 4 },
  group: { borderColor: "#d0d5dd", borderWidth: 1, borderRadius: 10, marginTop: 10,
    overflow: "hidden" },
  groupHeader: { minHeight: 62, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row",
    alignItems: "center", justifyContent: "space-between", backgroundColor: "#f8fafc" },
  groupHeadingColumn: { flex: 1, paddingRight: 10 },
  groupTitle: { fontWeight: "800", fontSize: 16, color: "#101828" },
  groupSummary: { color: "#475467", fontSize: 13, marginTop: 2 },
  groupStatusColumn: { alignItems: "flex-end" },
  groupStatus: { color: "#067647", backgroundColor: "#ecfdf3", borderRadius: 12,
    paddingHorizontal: 8, paddingVertical: 2, fontSize: 12, fontWeight: "700" },
  groupStatusPending: { color: "#93370d", backgroundColor: "#fffaeb" },
  groupChevron: { color: "#344054", fontSize: 12, marginTop: 5 },
  groupMeta: { color: "#475467", fontSize: 12, paddingHorizontal: 12, paddingVertical: 8 },
  processingMessage: { color: "#475467", fontStyle: "italic", paddingHorizontal: 12,
    paddingVertical: 14 },
  resultRow: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderTopColor: "#eaecf0", borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 7,
    borderLeftWidth: 4, borderLeftColor: "transparent" },
  resultHigh: { borderLeftColor: "#b42318", backgroundColor: "#fff6f5" },
  resultLow: { borderLeftColor: "#175cd3", backgroundColor: "#f5f8ff" },
  resultNameColumn: { flex: 1, minWidth: 0, paddingRight: 12 },
  resultName: { color: "#101828", fontWeight: "600", fontSize: 14, lineHeight: 18 },
  reference: { color: "#667085", fontSize: 12, lineHeight: 16, marginTop: 1 },
  resultValueColumn: { width: "43%", minWidth: 132, alignItems: "flex-end" },
  measurement: { maxWidth: "100%", flexDirection: "row", alignItems: "baseline", justifyContent: "flex-end",
    flexWrap: "wrap", columnGap: 4 },
  qualitativeMeasurement: { backgroundColor: "#f2f4f7", borderRadius: 8, paddingHorizontal: 9,
    paddingVertical: 4 },
  resultValue: { color: "#101828", fontSize: 17, lineHeight: 21, fontWeight: "800", textAlign: "right",
    fontVariant: ["tabular-nums"] },
  resultUnit: { color: "#475467", fontSize: 12, lineHeight: 18, fontWeight: "600" },
  qualitativeValue: { fontSize: 16 },
  resultValueHigh: { color: "#912018" },
  resultValueLow: { color: "#1849a9" },
  flag: { color: "#067647", backgroundColor: "#ecfdf3", borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2, marginTop: 2, fontSize: 11, fontWeight: "800" },
  flagHigh: { color: "#b42318", backgroundColor: "#fee4e2" },
  flagLow: { color: "#175cd3", backgroundColor: "#d1e9ff" },
  semanticValue: { alignItems: "flex-end", maxWidth: "100%" },
  semanticHint: { color: "#667085", fontSize: 11, lineHeight: 14, marginTop: 1, textAlign: "right" },
  pendingValue: { color: "#93370d", fontWeight: "700", textAlign: "right" },
  ambiguousValue: { color: "#93370d", fontWeight: "800", textAlign: "right" },
  missingValue: { color: "#b42318", fontWeight: "700", textAlign: "right" },
  notApplicable: { color: "#475467", fontStyle: "italic", textAlign: "right" },
});
