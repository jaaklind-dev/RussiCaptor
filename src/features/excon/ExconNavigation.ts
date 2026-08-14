export type ExconNavigate = (route: "/excon/dashboard" | "/excon/catalog") => void;

export function openExerciseDashboard(navigate: ExconNavigate): void {
  navigate("/excon/dashboard");
}

export function openExerciseCatalog(navigate: ExconNavigate): void {
  navigate("/excon/catalog");
}
