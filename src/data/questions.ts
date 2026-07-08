import { Question } from "@/models/Question";

export const questions: Question[] = [
  {
    id: "Q-001",
    exerciseId: "demo",
    patientId: "PT-001",
    category: "Toitumine",
    prompt: "Kas patsient sõi eile midagi?",
    answer: "Jah, sõi eile õhtul väljas.",
    visibility: "hidden",
    order: 1,
  },
  {
    id: "Q-002",
    exerciseId: "demo",
    patientId: "PT-001",
    category: "Toitumine",
    prompt: "Kus patsient sõi?",
    answer: "Restoranis. Täpsemal küsimisel: Jõhvis.",
    visibility: "hidden",
    order: 2,
  },
  {
    id: "Q-003",
    exerciseId: "demo",
    patientId: "PT-001",
    category: "Neuro",
    prompt: "Kas on kahelinägemist?",
    answer: "Jah, patsient kirjeldab kahelinägemist.",
    visibility: "hidden",
    order: 3,
  },
];