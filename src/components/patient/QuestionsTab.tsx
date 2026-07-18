import { Pressable, StyleSheet, Text, View } from "react-native";

import { Question } from "@/models/Question";

type Props = {

  questions: Question[];

  onReveal: (questionId: string) => void;

};

export default function QuestionsTab({ questions, onReveal }: Props) {

  return (

    <View style={styles.card}>

      <Text style={styles.sectionTitle}>Questions</Text>

      {questions.map((question) => (

        <View key={question.id} style={styles.questionBlock}>

          <Text style={styles.category}>{question.category}</Text>

          <Text style={styles.prompt}>{question.prompt}</Text>

          <Pressable

            style={styles.revealButton}

            onPress={() => onReveal(question.id)}

          >

            <Text style={styles.revealButtonText}>Reveal answer</Text>

          </Pressable>

          {question.visibility === "revealed" && (

            <Text style={styles.answer}>{question.answer}</Text>

          )}

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

  answer: {

    marginTop: 10,

    fontSize: 16,

    color: "#222",

    lineHeight: 22,

  },

});
