import type { AnalyticsCategory, MetricEvidenceReference, MetricScope, MetricUnit } from "@/models/analytics/Analytics";
import type { ExerciseTimelineCategory, ExerciseTimelineEvent, ExerciseTimelineGroup, ExerciseTimelineSeverity } from "@/models/exercise/ExerciseTimelineEvent";

const explicit = (value: string, labels: Readonly<Record<string, string>>, kind: string): string => labels[value] ?? `Tundmatu ${kind}: ${value}`;

export const timelineCategoryLabel = (value: ExerciseTimelineCategory | string): string => explicit(value, {
  EXERCISE: "õppus", PATIENT: "patsient", COMMAND: "käsk", SYSTEM: "süsteem", AUDIT: "audit",
}, "ajajoone kategooria");

export const timelineSeverityLabel = (value: ExerciseTimelineSeverity | string): string => explicit(value, {
  INFO: "teave", WARNING: "hoiatus", ERROR: "viga",
}, "raskusaste");

export const timelineGroupLabel = (value: ExerciseTimelineGroup | string): string => explicit(value, {
  NONE: "rühmitamata", TODAY: "täna", SIMULATION_MINUTE: "simulatsiooniminut", PATIENT: "patsient", CATEGORY: "kategooria",
}, "ajajoone rühm");
export const timelineSectionLabel = (group: ExerciseTimelineGroup, key: string): string => group === "NONE" ? "Kõik sündmused"
  : group === "TODAY" ? "Täna" : group === "SIMULATION_MINUTE" ? `T+${key} min`
    : group === "CATEGORY" ? timelineCategoryLabel(key) : key === "EXERCISE" ? "Õppus" : key;

const eventTypeLabels: Readonly<Record<string, string>> = {
  ExerciseStarted: "Õppus käivitati", ExercisePaused: "Õppus peatati", ExerciseResumed: "Õppus jätkus",
  ExerciseCompleted: "Õppus lõpetati", ExerciseSpeedChanged: "Simulatsiooni kiirust muudeti",
  RESPIRATORY_DETERIORATION: "Hingamisseisundi halvenemine", AIRWAY_OBSTRUCTION: "Hingamisteede sulgus",
  VOMITING: "Oksendamine", HYPOTENSION: "Hüpotensioon", REDUCED_CONSCIOUSNESS: "Teadvusseisundi halvenemine",
  RECOVERY_TRIGGER: "Taastumise käivitamine", CPR_STARTED: "Elustamine alustati", CPR_STOPPED: "Elustamine lõpetati",
  DEFIBRILLATION_ATTEMPT: "Defibrillatsioonikatse", CARDIAC_ARREST_STARTED: "Südameseiskus",
  PELVIC_BINDER_APPLICATION: "Vaagnalahase paigaldamine", CHEST_DRAIN_APPLICATION: "Pleuradreeni paigaldamine",
};
const authoredTitleLabels: Readonly<Record<string, string>> = {
  "Exercise started": "Õppus käivitati", "Exercise paused": "Õppus peatati", "Exercise resumed": "Õppus jätkus",
  "Exercise completed": "Õppus lõpetati", "Simulation speed changed": "Simulatsiooni kiirust muudeti",
  "Exercise command rejected": "Õppuse juhtimiskäsk lükati tagasi", "Patient event command rejected": "Patsiendisündmuse käsk lükati tagasi",
  "Clinical runtime advanced": "Kliiniline simulatsioon liikus edasi", "Chest drain inserted": "Pleuradreen paigaldati",
  "Pelvic binder applied": "Vaagnalahas paigaldati", "Exercise Controller event injected": "Õppuse juhtimiskeskus lisas sündmuse",
};
export const timelineEventTitleLabel = (event: Pick<ExerciseTimelineEvent, "type" | "title">): string => eventTypeLabels[event.type] ?? authoredTitleLabels[event.title] ?? `Sündmus: ${event.type}`;

export const timelineEventDescriptionLabel = (description?: string): string | undefined => {
  if (!description) return undefined;
  const runtimeAdvance = description.match(/^Canonical patient runtime advanced by (\d+) seconds$/);
  if (runtimeAdvance) return `Patsiendi kanooniline simulatsioon liikus ${runtimeAdvance[1]} sekundit edasi`;
  return ({
    "Canonical pleural drainage intervention applied": "Kanooniline pleuradreeni sekkumine rakendati",
    "Canonical cardiac state ARREST": "Kanooniline südameseiskuse seisund",
  } as Readonly<Record<string, string>>)[description] ?? description;
};

export const timelineActorLabel = (value: string): string => ({
  "Exercise Controller": "õppuse juhtimiskeskus", System: "süsteem", Runtime: "simulatsioonimootor",
  Instructor: "instruktor", "Case Manager": "juhtumikorraldaja", Patient: "patsient", Device: "seade", EXCON: "Mängujuht",
}[value] ?? value);

export const patientOutcomeLabel = (value: string): string => explicit(value, {
  ALIVE: "elus", DECEASED: "surnud", TRANSFERRED: "üle antud", STILL_ACTIVE: "endiselt aktiivne", COMPLETED_SCENARIO: "stsenaarium lõpetatud",
}, "patsiendi tulemus");

export const analyticsCategoryLabel = (value: AnalyticsCategory | string): string => explicit(value, {
  EXERCISE_FLOW: "õppuse kulg", PATIENT_CARE: "patsiendikäsitlus", OWNERSHIP: "vastutus", INTERVENTIONS: "sekkumised",
  MEDICATIONS: "ravimid", DIAGNOSTICS: "diagnostika", RESOURCES: "ressursid", COMMANDS: "käsud", ASSESSMENT: "hindamine", SYSTEM: "süsteem",
}, "analüütikakategooria");

export const metricScopeLabel = (value: MetricScope | string): string => explicit(value, {
  EXERCISE: "õppus", PATIENT: "patsient", CASE_MANAGER: "juhtumikorraldaja", RESOURCE: "ressurss", COMMAND: "käsk",
}, "mõõdiku ulatus");

export const analyticsUnitLabel = (value: MetricUnit | string): string => explicit(value, {
  SECONDS: "s", COUNT: "arv", PERCENT: "%", BOOLEAN: "tõeväärtus", RATIO: "suhe", TEXT: "tekst", NONE: "ühikuta",
}, "mõõtühik");

const metricNames: Readonly<Record<string, string>> = {
  "Exercise duration": "Õppuse kestus", "Timeline event count": "Ajajoone sündmuste arv", "Pause count": "Peatamiste arv",
  "Total paused duration": "Pauside kogukestus", "Running duration": "Tööaja kestus", "Average simulation speed": "Simulatsiooni keskmine kiirus",
  "Maximum simulation speed": "Simulatsiooni suurim kiirus", "Exercise control commands": "Õppuse juhtimiskäsud", "Audit event count": "Auditisündmuste arv",
  "Timeline events": "Ajajoone sündmused", "Exercise events": "Õppuse sündmused", "Patient events": "Patsiendisündmused",
  "Command events": "Käsusündmused", "Audit events": "Auditisündmused", "Rejected commands": "Tagasilükatud käsud",
  "Accepted commands": "Vastuvõetud käsud", "Event density": "Sündmuste sagedus", "Simulation events per minute": "Simulatsioonisündmusi minutis",
  "Average ownership duration": "Keskmine vastutuse kestus", "Longest ownership duration": "Pikim vastutuse kestus",
  "Shortest ownership duration": "Lühim vastutuse kestus", "Ownership handovers": "Vastutuse üleandmised",
  "Patients without owner": "Vastutajata patsiendid", "Multiple ownership conflicts": "Mitme vastutaja konfliktid",
  "Time to first ownership": "Aeg esimese vastutaja määramiseni", "Ownership changes": "Vastutaja muutused",
  "Assigned Case Managers": "Määratud juhtumikorraldajad", "Participation duration": "Osalemise kestus", "Patient completed": "Patsiendi stsenaarium lõpetatud",
  "Patient lifetime": "Patsiendi kestus õppuses", "Transfer count": "Üleandmiste arv", "First intervention delay": "Aeg esimese sekkumiseni",
  "Medication count": "Ravimisündmuste arv", "Order count": "Korralduste arv", "Imaging request count": "Piltdiagnostika tellimuste arv",
  "Laboratory request count": "Laboriuuringute tellimuste arv", "Airway intervention count": "Hingamisteede sekkumiste arv",
  "Respiratory intervention count": "Hingamissekkumiste arv", "Circulation intervention count": "Vereringesekkumiste arv",
  "Resource assignments": "Ressursside määramised", "Resource releases": "Ressursside vabastamised", "Peak concurrent usage": "Suurim samaaegne kasutus",
  "Average resource utilization": "Ressursside keskmine kasutus", "Unused resources": "Kasutamata ressursid",
  "Total expectations": "Ootusi kokku", "Applicable expectations": "Kohalduvad ootused", "Assessable expectations": "Hinnatavad ootused",
  "MET expectations": "Täidetud ootused", "NOT MET expectations": "Täitmata ootused", "Not applicable expectations": "Mittekohalduvad ootused",
  "Unavailable expectations": "Mittehinnatavad ootused", "Assessment completion ratio": "Hindamise täielikkuse osakaal",
  "Expectation satisfaction ratio": "Ootuste täitmise osakaal",
};
export const analyticsMetricNameLabel = (metricId: string, canonicalName: string): string => metricNames[canonicalName] ?? `Mõõdik: ${metricId}`;

export const evidenceSourceLabel = (value: MetricEvidenceReference["sourceType"] | string): string => explicit(value, {
  TIMELINE_EVENT: "ajajoone sündmus", PATIENT_SUMMARY: "patsiendi kokkuvõte", EXERCISE_SUMMARY: "õppuse kokkuvõte",
  AUDIT_EVENT: "auditisündmus", DEBRIEF_FIELD: "debriifi väli", ASSESSMENT_RESULT: "hindamistulemus", ASSESSMENT_REPORT: "hindamisaruanne",
}, "tõendusallikas");
