export type Patient = {

  id: string;

  isikukood: string;

  name: string;

  triage: "P1" | "P2" | "P3" | "P4";

  status: "Active" | "Incoming" | "Transferred" | "Completed";

  location: string;

  lastSeen: string;

};

export const allPatients: Patient[] = [

  {

    id: "PT-001",

    isikukood: "38701032343",

    name: "Jüri Kask",

    triage: "P2",

    status: "Active",

    location: "EMO triaaž",

    lastSeen: "09:22",

  },

];