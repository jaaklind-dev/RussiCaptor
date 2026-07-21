export type LocationZone = {
  id: string;
  exerciseId: string;
  code: string;
  name: string;
  building?: string;
  floor?: string;
  visibility: "hidden" | "available";
};
