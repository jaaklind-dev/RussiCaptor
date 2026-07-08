export type Exercise = {
  id: string;
  name: string;
  description: string;
  startTime: string;
  status: "draft" | "running" | "completed";
};