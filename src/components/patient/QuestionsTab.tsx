import { QuestionItem } from "@/models/Patient";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  questions: QuestionItem[];
};

export default function QuestionsTab({ questions }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Questions</Text>

      {questions.map((question) => (
        <View key={question.id} style={styles.questionBlock}>
          <Text style={styles.category}>{question.category}</Text>
          <Text style={styles.prompt}>{question.prompt}</Text>

          <Pressable style={styles.revealButton}>
            <Text style={styles.revealButtonText}>Reveal answer</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#f2f4f7",
    borderRadius: 16,
    padding: 18,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 14,
  },
  questionBlock: {
    borderTopWidth: 1,
    borderTopColor: "#d0d5dd",
    paddingTop: 12,
    marginTop: 12,
  },
  category: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#005BBB",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  prompt: {
    fontSize: 16,
    lineHeight: 23,
    color: "#333",
  },
  revealButton: {
    backgroundColor: "#005BBB",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginTop: 10,
    alignSelf: "flex-start",
  },
  revealButtonText: {
    color: "#ffffff",
    fontWeight: "bold",
  },
});