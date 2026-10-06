import { useLocalSearchParams } from "expo-router";

import AdminExerciseCreateScreen from "@/components/admin/AdminExerciseCreateScreen";

export default function AdminExerciseCreateRoute() {
  const params = useLocalSearchParams<{ packageId?: string | string[]; packageVersion?: string | string[] }>();
  return <AdminExerciseCreateScreen routeInput={params} />;
}
