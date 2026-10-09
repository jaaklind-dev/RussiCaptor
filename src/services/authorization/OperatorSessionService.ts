import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import type { PrincipalState, RoleAssignment } from "@/models/authorization/Authorization";
import { supabase } from "@/services/SupabaseService";
import { setAuthenticatedCaseManager } from "@/services/CurrentUserService";
import { SupabaseAuthenticationAdapter } from "./SupabaseAuthenticationAdapter";
import { SupabaseRoleAuthority } from "./SupabaseRoleAuthority";
import { PrincipalService } from "./PrincipalService";
import { completeOperatorSignOutDrain, prepareOperatorSignOut } from "./OperatorSignOutLifecycle";

export type OperatorProfile = Readonly<{ userId: string; displayName: string }>;
export type OperatorSessionState = Readonly<
  | { state: "LOADING" }
  | { state: "UNAUTHENTICATED" }
  | { state: "UNAUTHORIZED"; userId: string; message: string }
  | { state: "UNAVAILABLE"; message: string }
  | { state: "AUTHENTICATED"; principal: Extract<PrincipalState, { state: "AUTHENTICATED" }>["principal"]; profile: OperatorProfile; isPlatformAdmin?: boolean;
      authorityRefresh?: "REFRESHING" | "TRANSIENT_ERROR" }
>;

let snapshot: OperatorSessionState = Object.freeze({ state: "LOADING" });
const listeners = new Set<() => void>();
let stopAuth: (() => void) | undefined;
let signOutInFlight: Promise<void> | undefined;
let refreshGeneration = 0;
let refreshInFlight: { expectedUserId?: string; promise: Promise<OperatorSessionState> } | undefined;
let authRefreshTimer: ReturnType<typeof setTimeout> | undefined;
const authorityRefreshTimeoutMs = 8_000;

function publish(next: OperatorSessionState): void {
  snapshot = Object.freeze(next);
  listeners.forEach(listener => listener());
}

export function subscribeOperatorSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOperatorSession(): OperatorSessionState { return snapshot; }

export function activeAssignments(assignments: readonly RoleAssignment[], now = new Date().toISOString()): readonly RoleAssignment[] {
  return assignments.filter(item => item.status === "ACTIVE" && (!item.expiresAt || item.expiresAt > now));
}

export function activeScopedExerciseIds(
  state: OperatorSessionState,
  role: Extract<RoleAssignment["role"], "CM" | "EXCON">,
  now = new Date().toISOString(),
): readonly string[] {
  if (state.state !== "AUTHENTICATED") return Object.freeze([]);
  return Object.freeze([...new Set(activeAssignments(state.principal.roleAssignments, now)
    .flatMap(item => item.role === role && item.scope.scopeType === "EXERCISE" ? [item.scope.scopeId] : []))].sort());
}

type ProfileResult = Readonly<{ state: "VERIFIED"; profile: OperatorProfile }> |
  Readonly<{ state: "DENIED" }> | Readonly<{ state: "UNAVAILABLE" }>;
async function resolveProfile(userId: string): Promise<ProfileResult> {
  if (!supabase) return { state: "UNAVAILABLE" };
  const { data, error, status } = await supabase.from("operator_profiles").select("user_id,display_name").eq("user_id", userId).maybeSingle();
  if (error) return { state: status === 401 || status === 403 ? "DENIED" : "UNAVAILABLE" };
  if (!data || data.user_id !== userId || typeof data.display_name !== "string" || !data.display_name.trim()) {
    return { state: "DENIED" };
  }
  return { state: "VERIFIED", profile: Object.freeze({ userId, displayName: data.display_name.trim() }) };
}

type AdminResult = Readonly<{ state: "VERIFIED"; value: boolean }> |
  Readonly<{ state: "DENIED" }> | Readonly<{ state: "UNAVAILABLE" }>;
async function resolvePlatformAdmin(): Promise<AdminResult> {
  if (!supabase) return { state: "UNAVAILABLE" };
  const { data, error, status } = await supabase.rpc("is_platform_admin");
  if (error) return { state: status === 401 || status === 403 ? "DENIED" : "UNAVAILABLE" };
  return typeof data === "boolean" ? { state: "VERIFIED", value: data } : { state: "UNAVAILABLE" };
}

async function resolveOperatorSession(): Promise<OperatorSessionState> {
  if (!supabase) return { state: "UNAVAILABLE", message: "Supabase pole seadistatud." };
  const principalState = await new PrincipalService(
    new SupabaseAuthenticationAdapter(supabase), new SupabaseRoleAuthority(supabase),
  ).resolve();
  if (principalState.state === "UNAUTHENTICATED") return { state: "UNAUTHENTICATED" };
  if (principalState.state === "UNAVAILABLE") return { state: "UNAVAILABLE", message: "Operaatori õigusi ei saanud kontrollida." };
  const userId = principalState.principal.userId;
  const admin = await resolvePlatformAdmin();
  if (admin.state === "DENIED") return { state: "UNAUTHORIZED", userId, message: "Administraatori õigus puudub." };
  if (admin.state === "UNAVAILABLE") return { state: "UNAVAILABLE", message: "Administraatori õigusi ei saanud kontrollida." };
  if (!activeAssignments(principalState.principal.roleAssignments).length && !admin.value) {
    return { state: "UNAUTHORIZED", userId, message: "Operaatorile pole aktiivset rolli määratud." };
  }
  const profile = await resolveProfile(userId);
  if (profile.state === "DENIED") return { state: "UNAUTHORIZED", userId, message: "Operaatori kinnitatud profiil puudub." };
  if (profile.state === "UNAVAILABLE") return { state: "UNAVAILABLE", message: "Operaatori profiili ei saanud kontrollida." };
  return { state: "AUTHENTICATED", principal: principalState.principal, profile: profile.profile,
    isPlatformAdmin: admin.value };
}

function boundedAuthorityRead<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("AUTHORITY_REFRESH_TIMEOUT")), authorityRefreshTimeoutMs);
    work.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

async function resolveWithTransientRetry(): Promise<OperatorSessionState> {
  const first = await resolveOperatorSession();
  // Read-only authority checks may fail briefly on reconnect. Retry once,
  // inside the same overall deadline; definitive denial never retries.
  return first.state === "UNAVAILABLE" && supabase ? resolveOperatorSession() : first;
}

export function refreshOperatorSession(expectedUserId?: string): Promise<OperatorSessionState> {
  if (refreshInFlight && refreshInFlight.expectedUserId === expectedUserId) return refreshInFlight.promise;
  const generation = ++refreshGeneration;
  const confirmed = snapshot.state === "AUTHENTICATED" &&
    (!expectedUserId || snapshot.profile.userId === expectedUserId) ? snapshot : undefined;
  if (confirmed) publish({ ...confirmed, authorityRefresh: "REFRESHING" });
  else publish({ state: "LOADING" });
  const task = (async (): Promise<OperatorSessionState> => {
    let result: OperatorSessionState;
    try { result = await boundedAuthorityRead(resolveWithTransientRetry()); }
    catch { result = { state: "UNAVAILABLE", message: "Operaatori õiguste kontroll aegus. Proovi uuesti." }; }
    if (generation !== refreshGeneration) return snapshot;
    if (expectedUserId && result.state === "AUTHENTICATED" && result.profile.userId !== expectedUserId) {
      publish({ state: "UNAUTHENTICATED" });
      return snapshot;
    }
    if (result.state === "UNAVAILABLE" && confirmed) publish({ ...confirmed, authorityRefresh: "TRANSIENT_ERROR" });
    else publish(result);
    if (snapshot.state === "AUTHENTICATED" && result.state === "AUTHENTICATED") {
      setAuthenticatedCaseManager({ id: result.profile.userId, name: result.profile.displayName });
    }
    return snapshot;
  })();
  const inFlight = task.finally(() => {
    if (refreshInFlight?.promise === inFlight) refreshInFlight = undefined;
  });
  refreshInFlight = { expectedUserId, promise: inFlight };
  return inFlight;
}

export async function signInOperator(email: string, password: string): Promise<OperatorSessionState> {
  if (!supabase) { publish({ state: "UNAVAILABLE", message: "Supabase pole seadistatud." }); return snapshot; }
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) { publish({ state: "UNAUTHENTICATED" }); throw new Error("Sisselogimine ebaõnnestus. Kontrolli kasutajatunnust ja parooli."); }
  return refreshOperatorSession();
}

export function signOutOperator(): Promise<void> {
  if (signOutInFlight) return signOutInFlight;
  const task = (async () => {
    try {
      // Canonical writer authority is authenticated state. It must be released
      // before Supabase removes that state and emits SIGNED_OUT.
      await prepareOperatorSignOut();
      if (supabase) {
        const { error } = await supabase.auth.signOut({ scope: "local" });
        if (error) throw error;
      }
      completeOperatorSignOutDrain();
      refreshGeneration += 1;
      refreshInFlight = undefined;
      publish({ state: "UNAUTHENTICATED" });
    } catch {
      throw new Error("Väljalogimine ei õnnestunud täielikult. Proovi uuesti.");
    }
  })();
  const inFlight = task.finally(() => {
    if (signOutInFlight === inFlight) signOutInFlight = undefined;
  });
  signOutInFlight = inFlight;
  return inFlight;
}

export function startOperatorSession(): () => void {
  stopAuth?.();
  if (!supabase) { publish({ state: "UNAVAILABLE", message: "Supabase pole seadistatud." }); return () => {}; }
  const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
    if (event === "SIGNED_OUT" || !session || session.user.is_anonymous) {
      if (authRefreshTimer) clearTimeout(authRefreshTimer);
      refreshGeneration += 1;
      refreshInFlight = undefined;
      completeOperatorSignOutDrain();
      publish({ state: "UNAUTHENTICATED" });
    }
    else if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "USER_UPDATED") {
      const userId = session.user.id;
      if (snapshot.state === "AUTHENTICATED" && snapshot.profile.userId !== userId) {
        refreshGeneration += 1;
        refreshInFlight = undefined;
        publish({ state: "LOADING" });
      }
      // Supabase auth callbacks must not call the same client asynchronously
      // before its internal auth lock has been released.
      if (authRefreshTimer) clearTimeout(authRefreshTimer);
      authRefreshTimer = setTimeout(() => { authRefreshTimer = undefined; void refreshOperatorSession(userId); }, 0);
    }
  });
  stopAuth = () => { if (authRefreshTimer) clearTimeout(authRefreshTimer); authRefreshTimer = undefined;
    data.subscription.unsubscribe(); };
  void refreshOperatorSession();
  return () => { stopAuth?.(); stopAuth = undefined; };
}

export function hasActiveRole(state: OperatorSessionState, role: RoleAssignment["role"], exerciseId?: string): boolean {
  if (state.state !== "AUTHENTICATED") return false;
  return activeAssignments(state.principal.roleAssignments).some(item => item.role === role &&
    (item.scope.scopeType === "GLOBAL" || Boolean(exerciseId && item.scope.scopeId === exerciseId)));
}

export function hasPlatformAdminAuthority(state: OperatorSessionState): boolean {
  return state.state === "AUTHENTICATED" && state.isPlatformAdmin === true;
}

export function hasOperationalAuthority(state: OperatorSessionState): boolean {
  return state.state === "AUTHENTICATED" && activeAssignments(state.principal.roleAssignments).length > 0;
}

export function resetOperatorSessionForTests(): void {
  stopAuth?.(); stopAuth = undefined;
  if (authRefreshTimer) clearTimeout(authRefreshTimer);
  authRefreshTimer = undefined;
  refreshGeneration += 1;
  refreshInFlight = undefined;
  signOutInFlight = undefined;
  snapshot = Object.freeze({ state: "LOADING" });
  listeners.clear();
}
