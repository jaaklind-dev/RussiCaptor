import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { Note } from "@/models/Note";

type Props = {
  notes: Note[];
  readOnly?: boolean;
  onAddNote: (text: string) => boolean | Promise<boolean>;
};

export default function NotesTab({ notes, readOnly = false, onAddNote }: Props) {
  const [draft, setDraft] = useState("");
  const submittedDraft = useRef<string | undefined>(undefined);

  async function saveNote(): Promise<void> {
    const normalizedDraft = draft.trim();
    if (!normalizedDraft || submittedDraft.current === normalizedDraft) return;
    submittedDraft.current = normalizedDraft;
    if (await onAddNote(normalizedDraft)) {
      setDraft("");
    } else {
      submittedDraft.current = undefined;
    }
  }

  function updateDraft(value: string): void {
    if (value.trim() !== submittedDraft.current) submittedDraft.current = undefined;
    setDraft(value);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Juhtumikorraldaja märkmed</Text>
      <Text style={styles.description}>Juhtumikorraldaja märkmed patsiendi käsitluse kohta.</Text>

      {!readOnly && (
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={updateDraft}
            placeholder="Lisa märge..."
            multiline
            textAlignVertical="top"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Salvesta märge"
            style={[styles.button, draft.trim().length === 0 && styles.buttonDisabled]}
            disabled={draft.trim().length === 0}
            onPress={() => void saveNote()}
          >
            <Text style={styles.buttonText}>Salvesta märge</Text>
          </Pressable>
        </View>
      )}

      {notes.length === 0 ? (
        <Text style={styles.empty}>Märkmeid ei ole.</Text>
      ) : (
        notes.map((note) => (
          <View key={note.id} style={styles.note}>
            <Text style={styles.noteText}>{note.text}</Text>
            <Text style={styles.meta}>
              {note.author} · {new Date(note.createdAt).toLocaleString("et-EE")}
            </Text>
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
  },
  description: {
    color: "#666",
    marginTop: 4,
    marginBottom: 14,
  },
  composer: {
    marginBottom: 16,
  },
  input: {
    minHeight: 100,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#98a2b3",
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
  button: {
    alignSelf: "flex-end",
    backgroundColor: "#005BBB",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 10,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "bold",
  },
  empty: {
    color: "#666",
    fontStyle: "italic",
  },
  note: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d0d5dd",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  noteText: {
    fontSize: 16,
    lineHeight: 23,
    color: "#222",
  },
  meta: {
    color: "#667085",
    fontSize: 13,
    marginTop: 8,
  },
});
