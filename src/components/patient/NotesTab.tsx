import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { Note } from "@/models/Note";

type Props = {
  notes: Note[];
  readOnly?: boolean;
  onAddNote: (text: string) => boolean;
};

export default function NotesTab({ notes, readOnly = false, onAddNote }: Props) {
  const [draft, setDraft] = useState("");

  function saveNote(): void {
    if (onAddNote(draft)) {
      setDraft("");
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>CM Notes</Text>
      <Text style={styles.description}>Case Manageri märkmed patsiendi käsitluse kohta.</Text>

      {!readOnly && (
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Lisa märge..."
            multiline
            textAlignVertical="top"
          />
          <Pressable
            style={[styles.button, draft.trim().length === 0 && styles.buttonDisabled]}
            disabled={draft.trim().length === 0}
            onPress={saveNote}
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
