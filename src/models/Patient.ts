import { Visibility } from "@/models/Visibility";
export type TriageCategory = "P1" | "P2" | "P3" | "P4";

export type PatientStatus =

  | "Active"

  | "Incoming"

  | "Transferred"

  | "Completed";

export type TimelineEvent = {

  id: string;

  time: string;

  title: string;

  description: string;

  visibility: "hidden",;

};

export type LabResult = {

  id: string;

  category: string;

  name: string;

  value: string;

  unit?: string;

  visibility: "hidden",

};

export type ImagingStudy = {

  id: string;

  type: "XR" | "CT" | "EKG" | "US" | "OTHER";

  title: string;

  description: string;

  file?: string;

  visibility: "hidden",

};

export type QuestionItem = {

  id: string;

  category: string;

  prompt: string;

  answer: string;

visibility: Visibility;

};

export type PatientNote = {

  id: string;

  title: string;

  text: string;

};

export type Mist = {

  mechanism: string;

  injuries: string;

  signs: string;

  treatment: string;

};

export type Patient = {

  id: string;

  isikukood: string;

  name: string;

  triage: TriageCategory;

  status: PatientStatus;

  location: string;

  lastSeen: string;

  mist: Mist;

  timeline: TimelineEvent[];

  labs: LabResult[];

  imaging: ImagingStudy[];

  questions: QuestionItem[];

  notes: PatientNote[];

});