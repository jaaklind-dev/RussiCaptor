import { prepareAllocatedExercise } from "../AllocatedExercisePreparation";
import { supabase } from "@/services/SupabaseService";
import { getOperatorSession } from "@/services/authorization/OperatorSessionService";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { activeExercisePackageService } from "../ActiveExercisePackageService";
import { createExerciseWithExistingBootstrap } from "@/services/admin/PlatformAdminExerciseCreation";
import { storeCompletedExerciseArchive } from "../CompletedExerciseArchiveService";

jest.mock("@/services/SupabaseService", () => ({ supabase: { from: jest.fn() } }));
jest.mock("@/services/authorization/OperatorSessionService", () => ({ getOperatorSession: jest.fn() }));
jest.mock("@/repositories/ExerciseSessionRepository", () => ({ getCanonicalExerciseSnapshot: jest.fn() }));
jest.mock("../ActiveExercisePackageService", () => ({ activeExercisePackageService: { getActive: jest.fn() } }));
jest.mock("../ExercisePreparationService", () => ({ captureCompletedExerciseArchive: jest.fn(() => ({ exerciseId: "OLD" })) }));
jest.mock("../CompletedExerciseArchiveService", () => ({ storeCompletedExerciseArchive: jest.fn() }));
jest.mock("@/services/admin/PlatformAdminExerciseCreation", () => ({ createExerciseWithExistingBootstrap: jest.fn(), getAdminExerciseCreationPhase: jest.fn(() => "IDLE") }));
const snapshot = { exerciseId: "OLD", version: 2, lifecycleState: "COMPLETED" };
const token = { id: "TOKEN", user_id: "ACTOR", status: "ACTIVE", consumed_exercise_id: null, expires_at: "2099-01-01T00:00:00Z" };
let query: Record<string, jest.Mock>;
beforeEach(() => {
  jest.clearAllMocks();
  (getCanonicalExerciseSnapshot as jest.Mock).mockReturnValue(snapshot);
  (getOperatorSession as jest.Mock).mockReturnValue({ state: "AUTHENTICATED", profile: { userId: "ACTOR" } });
  (activeExercisePackageService.getActive as jest.Mock).mockReturnValue({ packageId: "PACKAGE", packageVersion: "1" });
  query = Object.fromEntries(["select", "eq", "is", "gt", "order", "limit"].map(name => [name, jest.fn(() => query)]));
  query.maybeSingle = jest.fn().mockResolvedValue({ data: token, error: null });
  (supabase!.from as jest.Mock).mockReturnValue(query);
  (createExerciseWithExistingBootstrap as jest.Mock).mockImplementation(async (_user, _identity, _op, bootstrap, beforeActivation) => {
    await bootstrap(); beforeActivation(); return "EX-SERVER-RESERVED";
  });
});
test("normal/package creation uses existing authority and detached server path before archiving", async () => {
  await expect(prepareAllocatedExercise("OP" )).resolves.toBe("EX-SERVER-RESERVED");
  expect(supabase!.from).toHaveBeenCalledWith("exercise_bootstrap_authorizations");
  expect(query.eq).toHaveBeenCalledWith("user_id", "ACTOR");
  expect(storeCompletedExerciseArchive).toHaveBeenCalledWith({ exerciseId: "OLD" });
});
test.each(["RUNNING", "PAUSED", "UNKNOWN", "READY"])("%s cannot allocate or replace runtime", async lifecycleState => {
  (getCanonicalExerciseSnapshot as jest.Mock).mockReturnValue({ ...snapshot, lifecycleState });
  await expect(prepareAllocatedExercise("OP")).rejects.toThrow();
  expect(createExerciseWithExistingBootstrap).not.toHaveBeenCalled();
  expect(storeCompletedExerciseArchive).not.toHaveBeenCalled();
});
test("missing bootstrap fails closed without local fallback or archive", async () => {
  query.maybeSingle.mockResolvedValue({ data: null, error: null });
  await expect(prepareAllocatedExercise("OP")).rejects.toThrow("BOOTSTRAP_UNAVAILABLE");
  expect(storeCompletedExerciseArchive).not.toHaveBeenCalled();
});
test("wrong-actor token rejected", async () => {
  query.maybeSingle.mockResolvedValue({ data: { ...token, user_id: "OTHER" }, error: null });
  await expect(prepareAllocatedExercise("OP")).rejects.toThrow("BOOTSTRAP_UNAVAILABLE");
});
test("concurrent runtime revision change prevents local activation", async () => {
  query.maybeSingle.mockImplementation(async () => {
    (getCanonicalExerciseSnapshot as jest.Mock).mockReturnValue({ ...snapshot, version: 3 });
    return { data: token, error: null };
  });
  await expect(prepareAllocatedExercise("OP")).rejects.toThrow("olek muutus");
  expect(storeCompletedExerciseArchive).not.toHaveBeenCalled();
});
test("authentication change prevents local activation", async () => {
  query.maybeSingle.mockImplementation(async () => {
    (getOperatorSession as jest.Mock).mockReturnValue({ state: "UNAUTHENTICATED" });
    return { data: token, error: null };
  });
  await expect(prepareAllocatedExercise("OP")).rejects.toThrow("olek muutus");
});
