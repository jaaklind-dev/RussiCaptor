/** Estonian presentation vocabulary. Canonical values must never be mutated through this module. */
export const et = Object.freeze({
  back: "Tagasi", close: "Sulge", cancel: "Tühista", confirm: "Kinnita", save: "Salvesta",
  retry: "Proovi uuesti", loading: "Laadimine…", unavailable: "Pole saadaval", unknown: "Tundmatu olek",
  exercise: "Õppus", patients: "Patsiendid", timeline: "Ajajoon", debrief: "debriif",
  analytics: "Analüütika", assessment: "Hindamine", evaluation: "Hinnang", status: "Olek",
  login: "Logi sisse", logout: "Logi välja", scanPatient: "Skaneeri patsient", scanLocation: "Skaneeri asukoht",
  history: "Ajalugu", settings: "Seaded", search: "Otsi", all: "Kõik", none: "Puudub",
  apply: "Rakenda", available: "Saadaval", evidence: "tõendusallikad", canonicalSource: "andmete lähteallikas",
});

const safe = (value: string, labels: Readonly<Record<string, string>>): string => labels[value] ?? `${et.unknown}: ${value}`;

export const exerciseLifecycleLabel = (value: string): string => safe(value, {
  READY: "Valmis", RUNNING: "Käimas", PAUSED: "Peatatud", COMPLETED: "Lõpetatud", DRAFT: "Mustand",
});
export const patientStatusLabel = (value: string): string => safe(value, {
  Active: "Aktiivne", Incoming: "Saabumas", Transferred: "Üle antud", Completed: "Lõpetatud",
  Stable: "Stabiilne", "Requires attention": "Vajab tähelepanu", Critical: "Kriitiline",
  "Life threatening": "Eluohtlik", Expectant: "Perspektiivitu",
});
export const instructorFilterOptionLabel = (filter: string, value: string): string => {
  if (value === "All") return et.all;
  if (filter === "triage" && value === "Expectant") return "Perspektiivitu";
  if (filter === "status") return ({
    Completed: "Lõpetatud", Critical: "Kriitiline", Stable: "Stabiilne",
  } as Readonly<Record<string, string>>)[value] ?? value;
  return value;
};
export const authorityStateLabel = (value: string): string => safe(value, {
  CONNECTING: "Ühendamine", WRITER: "Aktiivne juht", READER: "Ainult vaatamine", CONFLICT: "Juhtimisõiguse konflikt",
  OFFLINE: "Võrguühenduseta", FAILED: "Juhtimisõiguse käivitamine ebaõnnestus", TAKEOVER_AVAILABLE: "Juhtimise ülevõtmine on võimalik",
});
export const assessmentStatusLabel = (value: string): string => safe(value, {
  MET: "Täidetud", NOT_MET: "Täitmata", NOT_APPLICABLE: "Ei kohaldu", UNAVAILABLE: "Pole hinnatav",
  PASS: "Läbitud", WARNING: "Hoiatus", FAIL: "Ebaõnnestunud", INFO: "Teave", VALUE: "Väärtus", ERROR: "Viga",
});
export const compatibilityLabel = (value: string): string => safe(value, {
  SUPPORTED: "Toetatud", LEGACY: "Pärandversioon", INCOMPATIBLE: "Ühildumatu",
});
export const processStatusLabel = (value: string): string => safe(value, {
  ACTIVE: "Aktiivne", RUNNING: "Käimas", COMPLETED: "Lõpetatud", CANCELLED: "Tühistatud", FAILED: "Ebaõnnestunud",
  Active: "Aktiivne", Resolved: "Lahenenud", Pending: "Ootel",
});
export const judgementLabel = (value: string): string => safe(value, {
  NOT_ASSESSED: "Hindamata", MEETS_EXPECTATION: "Vastab ootusele", PARTIALLY_MEETS: "Vastab osaliselt",
  DOES_NOT_MEET: "Ei vasta ootusele", NOT_APPLICABLE: "Ei kohaldu",
});
export const clinicalEffectLabel = (value: string): string => safe(value, {
  PELVIC_STABILIZATION: "Vaagna stabiliseerimine", PLEURAL_DECOMPRESSION: "Pleura dekompressioon",
  OXYGEN_THERAPY: "Hapnikravi", VENTILATION_SUPPORT: "Hingamise toetamine",
});

/** Presentation-only labels for repository-owned package metadata. Unknown authored values stay verbatim. */
export const exercisePackageNameLabel = (value: string): string => ({
  "Airway Clinical Module Reference Package": "Hingamisteede kliinilise mooduli näidispakett",
  "Respiratory Failure Clinical Module Reference Package": "Hingamispuudulikkuse kliinilise mooduli näidispakett",
  "Medication Core Clinical Module Reference Package": "Ravimite põhimooduli näidispakett",
  "Cardiac Arrest Reference Package": "Südameseiskuse näidispakett",
  "ALS Clinical Module Reference Package": "ALS-i kliinilise mooduli näidispakett",
  "ALS Generic Protocol Reference Package": "ALS-i üldprotokolli näidispakett",
  "Trauma Core Reference Package": "Trauma põhimooduli näidispakett",
  "Pelvic Injury Reference Package": "Vaagnavigastuse näidispakett",
  "Massive Hemopneumothorax Reference Package": "Massiivse hemopneumotooraksi näidispakett",
  "Runtime Continuity Reference Package": "Simulatsiooni järjepidevuse näidispakett",
  "ALS Template Package": "ALS-i mallpakett",
  "EMERGENCY DEPARTMENT Template Package": "Erakorralise meditsiini mallpakett",
  "MASCAL Template Package": "Masskannatanute õppuse mallpakett",
  "TRAUMA Template Package": "Traumaõppuse mallpakett",
  "CUSTOM Template Package": "Kohandatud õppuse mallpakett",
  "BOTULISM Template Package": "Botulismiõppuse mallpakett",
}[value] ?? value);

export const exercisePackageTagLabel = (value: string): string => ({
  airway: "hingamisteed", als: "ALS", botulism: "botulism", canonical: "kanooniline",
  "cardiac-arrest": "südameseiskus", "clinical-module": "kliiniline moodul", custom: "kohandatud",
  "emergency_department": "erakorraline meditsiin", foundation: "aluskiht", hemopneumothorax: "hemopneumotooraks",
  johvi: "Jõhvi", mascal: "masskannatanud", "medication-core": "ravimite põhimoodul",
  "open-book": "avatud raamatu tüüpi", "pelvic-injury": "vaagnavigastus", persistence: "püsivus",
  "pleural-injury": "pleuravigastus", protocol: "protokoll", reference: "näidis",
  "respiratory-failure": "hingamispuudulikkus", "runtime-continuity": "simulatsiooni järjepidevus",
  technical: "tehniline", template: "mall", trauma: "trauma",
}[value] ?? value);

export const exerciseProfileLabel = (value: string): string => ({
  ALS: "ALS", BOTULISM: "Botulism", CUSTOM: "Kohandatud", EMERGENCY_DEPARTMENT: "Erakorraline meditsiin",
  MASCAL: "Masskannatanud", TRAUMA: "Trauma",
}[value] ?? value.replaceAll("_", " "));
