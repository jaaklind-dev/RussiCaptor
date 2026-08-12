import type { ExerciseEvaluationResult } from "@/models/evaluation/ExerciseEvaluation";
import type { InstructorDimensionJudgement, InstructorEvaluationDraft, InstructorEvaluationView, InstructorExpectationJudgement, InstructorJudgement } from "@/models/evaluation/InstructorEvaluation";
import { instructorJudgements } from "@/models/evaluation/InstructorEvaluation";
import { loadInstructorEvaluationAccess, saveCurrentInstructorEvaluation } from "@/services/InstructorEvaluationService";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

const empty: InstructorEvaluationDraft = Object.freeze({ dimensionJudgements: Object.freeze([]), expectationJudgements: Object.freeze([]) });
const label = (value: InstructorJudgement) => value.replaceAll("_", " ");

export function InstructorEvaluationPanel({ source, readOnly = false }: { source: ExerciseEvaluationResult; readOnly?: boolean }) {
  const [view, setView] = useState<InstructorEvaluationView>();
  const [canWrite, setCanWrite] = useState(false);
  const [draft, setDraft] = useState<InstructorEvaluationDraft>(empty);
  const [editing, setEditing] = useState(false); const [pending, setPending] = useState(false); const [message, setMessage] = useState("Loading authorization and evaluation…");
  useEffect(() => {
    let active = true;
    void loadInstructorEvaluationAccess().then(access => {
      if (!active) return; const result = access.read; setCanWrite(access.canWrite);
      if (!result.ok) { setMessage(result.code.replaceAll("_", " ")); return; }
      setView(result.value); setDraft(result.value?.evaluation ?? empty); setMessage(result.value ? "" : "No human judgement has been recorded.");
    });
    return () => { active = false; };
  }, []);
  const dimensions = new Map(draft.dimensionJudgements.map(item => [item.dimensionId, item]));
  const expectations = new Map(draft.expectationJudgements.map(item => [`${item.dimensionId}:${item.expectationId}:${item.subjectId ?? ""}`, item]));
  function setDimension(item: InstructorDimensionJudgement) { setDraft(current => ({ ...current, dimensionJudgements: [...current.dimensionJudgements.filter(value => value.dimensionId !== item.dimensionId), item] })); }
  function setExpectation(item: InstructorExpectationJudgement) { const key = `${item.dimensionId}:${item.expectationId}:${item.subjectId ?? ""}`; setDraft(current => ({ ...current, expectationJudgements: [...current.expectationJudgements.filter(value => `${value.dimensionId}:${value.expectationId}:${value.subjectId ?? ""}` !== key), item] })); }
  async function save() {
    setPending(true); setMessage(""); const result = await saveCurrentInstructorEvaluation(draft, view?.evaluation.revision ?? 0); setPending(false);
    if (!result.ok) { setMessage(result.code.replaceAll("_", " ")); return; }
    setView(result.value); setDraft(result.value.evaluation); setEditing(false); setMessage("Saved and confirmed by the backend.");
  }
  return <View style={styles.card}><View style={styles.header}><View style={styles.headerCopy}><Text style={styles.title}>Instructor Evaluation</Text><Text style={styles.subtitle}>Human-authored interpretation · separate from machine results</Text></View>{!readOnly && canWrite && !editing && <Pressable style={styles.edit} onPress={() => setEditing(true)}><Text style={styles.editText}>Edit</Text></Pressable>}</View>
    {view?.status === "SOURCE_CHANGED" && <Text style={styles.warning}>SOURCE CHANGED — this revision refers to an earlier WP-40 evaluation.</Text>}
    {source.dimensions.map(dimension => { const dimensionValue = dimensions.get(dimension.dimensionId); return <View key={dimension.dimensionId} style={styles.dimension}><Text style={styles.dimensionTitle}>{dimension.title}</Text><JudgementControl value={dimensionValue?.judgement} disabled={!editing || readOnly} onChange={judgement => setDimension({ dimensionId: dimension.dimensionId, judgement, ...(dimensionValue?.comment ? { comment: dimensionValue.comment } : {}) })} />
      {(editing || dimensionValue?.comment) && <TextInput editable={editing && !readOnly} value={dimensionValue?.comment ?? ""} onChangeText={comment => setDimension({ dimensionId: dimension.dimensionId, judgement: dimensionValue?.judgement ?? "NOT_ASSESSED", ...(comment ? { comment } : {}) })} placeholder="Dimension comment" multiline style={styles.input} />}
      {dimension.expectations.map((item, index) => { const key = `${dimension.dimensionId}:${item.expectationId}:${item.subjectId ?? ""}`; const value = expectations.get(key); return <View key={`${key}:${index}`} style={styles.expectation}><Text style={styles.machine}>{item.classification} · {item.status.replaceAll("_", " ")}</Text><Text style={styles.expectationId}>{item.expectationId}{item.patientId ? ` · ${item.patientId}` : ""}</Text><JudgementControl value={value?.judgement} disabled={!editing || readOnly} onChange={judgement => setExpectation({ dimensionId: dimension.dimensionId, expectationId: item.expectationId, ...(item.subjectId ? { subjectId: item.subjectId } : {}), judgement, ...(value?.comment ? { comment: value.comment } : {}) })} />{(editing || value?.comment) && <TextInput editable={editing && !readOnly} value={value?.comment ?? ""} onChangeText={comment => setExpectation({ dimensionId: dimension.dimensionId, expectationId: item.expectationId, ...(item.subjectId ? { subjectId: item.subjectId } : {}), judgement: value?.judgement ?? "NOT_ASSESSED", ...(comment ? { comment } : {}) })} placeholder="Expectation comment" multiline style={styles.input} />}</View>; })}</View>; })}
    {(editing || draft.overallComment) && <TextInput editable={editing && !readOnly} value={draft.overallComment ?? ""} onChangeText={overallComment => setDraft(current => ({ ...current, ...(overallComment ? { overallComment } : { overallComment: undefined }) }))} placeholder="Overall comment" multiline style={styles.input} />}
    {view && <Text style={styles.meta}>Evaluator {view.evaluation.evaluator.userId} · revision {view.evaluation.revision} · source {view.evaluation.source.evaluationHash.slice(0, 16)}…</Text>}
    {view && <Text style={styles.meta}>Auditable revisions: {view.history.map(item => item.revision).join(", ")}</Text>}
    {!!message && <Text style={message.includes("Saved") ? styles.success : styles.message}>{message}</Text>}
    {editing && !readOnly && <View style={styles.actions}><Pressable disabled={pending} style={styles.cancel} onPress={() => { setDraft(view?.evaluation ?? empty); setEditing(false); }}><Text>Cancel</Text></Pressable><Pressable disabled={pending} style={styles.save} onPress={() => void save()}><Text style={styles.saveText}>{pending ? "Saving…" : "Save revision"}</Text></Pressable></View>}
    <Text style={styles.boundary}>No score, grade, pass/fail, competency or AI-generated judgement.</Text>
  </View>;
}

function JudgementControl({ value, disabled, onChange }: { value?: InstructorJudgement; disabled: boolean; onChange: (value: InstructorJudgement) => void }) {
  return <View style={styles.choices}>{instructorJudgements.map(item => <Pressable key={item} disabled={disabled} onPress={() => onChange(item)} style={[styles.choice, value === item && styles.choiceActive]}><Text style={[styles.choiceText, value === item && styles.choiceTextActive]}>{label(item)}</Text></Pressable>)}</View>;
}

const styles = StyleSheet.create({ card: { backgroundColor: "#f7f5ff", borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "#c0b6f2" }, header: { flexDirection: "row", justifyContent: "space-between", gap: 8 }, headerCopy: { flex: 1 }, title: { color: "#172b4d", fontSize: 18, fontWeight: "900" }, subtitle: { color: "#5e6c84", marginTop: 3 }, edit: { flexShrink: 0, backgroundColor: "#6554c0", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 }, editText: { color: "#fff", fontWeight: "900" }, warning: { color: "#7a5700", backgroundColor: "#fff3cd", padding: 8, borderRadius: 7, marginTop: 10, fontWeight: "800" }, dimension: { marginTop: 14 }, dimensionTitle: { fontWeight: "900", color: "#172b4d" }, expectation: { backgroundColor: "#fff", borderRadius: 8, padding: 10, marginTop: 8 }, machine: { color: "#005bbb", fontWeight: "900", fontSize: 11 }, expectationId: { color: "#172b4d", fontWeight: "800", marginTop: 3 }, choices: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 7 }, choice: { borderWidth: 1, borderColor: "#c1c7d0", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 999 }, choiceActive: { backgroundColor: "#6554c0", borderColor: "#6554c0" }, choiceText: { color: "#42526e", fontSize: 10, fontWeight: "800" }, choiceTextActive: { color: "#fff" }, input: { borderWidth: 1, borderColor: "#c1c7d0", borderRadius: 8, padding: 9, backgroundColor: "#fff", marginTop: 7, minHeight: 42 }, meta: { color: "#6b778c", fontSize: 11, marginTop: 8, fontFamily: "monospace" }, message: { color: "#7a5700", marginTop: 9 }, success: { color: "#006644", marginTop: 9, fontWeight: "800" }, actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 10 }, cancel: { backgroundColor: "#ebecf0", padding: 10, borderRadius: 8 }, save: { backgroundColor: "#006644", padding: 10, borderRadius: 8 }, saveText: { color: "#fff", fontWeight: "900" }, boundary: { color: "#6b778c", fontSize: 11, marginTop: 10 } });
