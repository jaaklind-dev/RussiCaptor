import { Patient } from "@/models/Patient";

export const allPatients: Patient[] = [

  {

    id: "PT-001",

    isikukood: "38701032343",

    name: "Jüri Kask",

    triage: "P2",

    status: "Active",

    location: "EMO triaaž",

    lastSeen: "09:22",

    mist: {

      mechanism: "Haigestus kodus, saabus EMO-sse omal jalal.",

      injuries: "Nägemishäire, nõrkus, neelamisel ebamugavus.",

      signs: "RR 138/82, HR 92, SpO₂ 97%, GCS 15.",

      treatment: "Ravi veel puudub.",

    },

    timeline: [

      {

        id: "TL-001",

        time: "0 min",

        title: "Saabumine EMO-sse",

        description: "Patsient saabub omal jalal. Kaebab nägemise hägustumist ja nõrkust.",

        revealed: true,

      },

      {

        id: "TL-002",

        time: "20 min",

        title: "Kõne muutub nasaalseks",

        description: "Kui CM otsustab kulgu arendada, muutub patsiendi kõne nasaalseks.",

        revealed: false,

      },

      {

        id: "TL-003",

        time: "35 min",

        title: "Neelamine halveneb",

        description: "Patsient ütleb, et vesi läheb kurku valesti.",

        revealed: false,

      },

    ],

    labs: [

      {

        id: "LAB-001",

        category: "ABG",

        name: "pH",

        value: "7.36",

        revealed: false,

      },

      {

        id: "LAB-002",

        category: "ABG",

        name: "pCO₂",

        value: "47",

        unit: "mmHg",

        revealed: false,

      },

    ],

    imaging: [

      {

        id: "IMG-001",

        type: "XR",

        title: "XR rindkere",

        description: "Ägedat infiltraati ei nähtu. Aspiratsiooni tunnused puuduvad.",

        revealed: false,

      },

    ],

    questions: [

      {

        id: "Q-001",

        category: "Toitumine",

        prompt: "Kas patsient sõi eile midagi?",

        answer: "Jah, sõi eile õhtul väljas.",

        revealed: false,

      },

      {

        id: "Q-002",

        category: "Toitumine",

        prompt: "Kus patsient sõi?",

        answer: "Gruusia restoranis. Täpsemal küsimisel: Jõhvis.",

        revealed: false,

      },

      {

        id: "Q-003",

        category: "Neuro",

        prompt: "Kas on kahelinägemist?",

        answer: "Jah, patsient kirjeldab kahelinägemist.",

        revealed: false,

      },

    ],

    notes: [

      {

        id: "NOTE-001",

        title: "CM truth file",

        text: "Tegelik stsenaariumi kahtlus on botulism. Ära avalda restorani vihjet enne, kui reageerijad küsivad toitumise või restorani kohta.",

      },

    ],

  },

];