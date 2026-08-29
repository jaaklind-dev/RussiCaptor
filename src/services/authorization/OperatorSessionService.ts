import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import type { PrincipalState, RoleAssignment } from "@/models/authorization/Authorization";
import { supabase } from "@/services/SupabaseService";
import { setAuthenticatedCaseManager } from "@/services/CurrentUserService";
import { SupabaseAuthenticationAdapter } from "./SupabaseAuthenticationAdapter";
import { SupabaseRoleAuthority } from "./SupabaseRoleAuthority";
import { PrincipalService } from "./PrincipalService";

export type OperatorProfile = Readonly<{ userId: string; displayName: string }>;
export type OperatorSessionState = Readonly<
  | { state: "LOADING" }
  | { state: "UNAUTHENTICATED" }
  | { state: "UNAUTHORIZED"; userId: string; message: string }
  | { state: "UNAVAILABLE"; message: string }
  | { state: "AUTHENTICATED"; principal: Extract<PrincipalState, { state: "AUTHENTICATED" }>["principal"]; profile: OperatorProfile }
>;

let snapshot: OperatorSessionState = Object.freeze({ state: "LOADING" });
const listeners = new Set<() => void>();
let stopAuth: (() => void) | undefined;

function publish(next: OperatorSessionState): void {
  snapshot = Object.freeze(next);
  listeners.forEach(listener => listener());
}

export function subscribeOperatorSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOperatorSession(): OperatorSessionState { return snapshot; }

function activeAssignments(assignments: readonly RoleAssignment[], now = new Date().toISOString()): readonly RoleAssignment[] {
  return assignments.filter(item => item.status === "ACTIVE" && (!item.expiresAt || item.expiresAt > now));
}

async function resolveProfile(userId: string): Promise<OperatorProfile | undefined> {
  if (!supabase) return undefined;
  const { data, error } = await supabase.from("operator_profiles").select("user_id,display_name").eq("user_id", userId).maybeSingle();
  if (error || !data || data.user_id !== userId || typeof data.display_name !== "string" || !data.display_name.trim()) return undefined;
  return Object.freeze({ userId, displayName: data.display_name.trim() });
}

export async function refreshOperatorSession(): Promise<OperatorSessionState> {
  if (!supabase) {
    publish({ state: "UNAVAILABLE", message: "Supabase pole seadistatud." });
    return snapshot;
  }
  publish({ state: "LOADING" });
  const principalState = await new PrincipalService(
    new SupabaseAuthenticationAdapter(supabase), new SupabaseRoleAuthority(supabase),
  ).resolve();
  if (principalState.state === "UNAUTHENTICATED") publish({ state: "UNAUTHENTICATED" });
  else if (principalState.state === "UNAVAILABLE") publish({ state: "UNAVAILABLE", message: "Operaatori õigusi ei saanud kontrollida." });
  else {
    const assignments = activeAssignments(principalState.principal.roleAssignments);
    if (!assignments.length) publish({ state: "UNAUTHORIZED", userId: principalState.principal.userId, message: "Operaatorile pole aktiivset rolli määratud." });
    else {
      const profile = await resolveProfile(principalState.principal.userId);
      if (!profile) publish({ state: "UNAUTHORIZED", userId: principalState.principal.userId, message: "Operaatori kinnitatud profiil puudub." });
      else {
        setAuthenticatedCaseManager({ id: profile.userId, name: profile.displayName });
        publish({ state: "AUTHENTICATED", principal: principalState.principal, profile });
      }
    }
  }
  return snapshot;
}

export async function signInOperator(email: string, password: string): Promise<OperatorSessionState> {
  if (!supabase) { publish({ state: "UNAVAILABLE", message: "Supabase pole seadistatud." }); return snapshot; }
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) { publish({ state: "UNAUTHENTICATED" }); throw new Error("Sisselogimine ebaõnnestus. Kontrolli kasutajatunnust ja parooli."); }
  return refreshOperatorSession();
}

export async function signOutOperator(): Promise<void> {
  if (supabase) await supabase.auth.signOut({ scope: "local" });
  publish({ state: "UNAUTHENTICATED" });
}

export function startOperatorSession(): () => void {
  stopAuth?.();
  if (!supabase) { publish({ state: "UNAVAILABLE", message: "Supabase pole seadistatud." }); return () => {}; }
  const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
    if (event === "SIGNED_OUT" || !session || session.user.is_anonymous) publish({ state: "UNAUTHENTICATED" });
    else if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "USER_UPDATED") void refreshOperatorSession();
  });
  stopAuth = () => data.subscription.unsubscribe();
  void refreshOperatorSession();
  return () => { stopAuth?.(); stopAuth = undefined; };
}

export function hasActiveRole(state: OperatorSessionState, role: RoleAssignment["role"], exerciseId?: string): boolean {
  if (state.state !== "AUTHENTICATED") return false;
  return activeAssignments(state.principal.roleAssignments).some(item => item.role === role &&
    (item.scope.scopeType === "GLOBAL" || Boolean(exerciseId && item.scope.scopeId === exerciseId)));
}
