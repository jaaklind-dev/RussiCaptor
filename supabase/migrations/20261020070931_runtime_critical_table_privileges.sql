-- Remove unused DDL/destructive privileges from the two untrusted API roles.
-- PUBLIC is included to close an alternate grant path; no privilege is added.
-- Deliberately preserve DML, REFERENCES, MAINTAIN, function EXECUTE, ownership,
-- RLS, existing triggers, defaults for unrelated/future tables and runtime data.
-- Repeatable: REVOKE of an already absent privilege does not change data.
revoke truncate, trigger on table public.runtime_writer_leases from public, anon, authenticated;
revoke truncate, trigger on table public.runtime_checkpoints from public, anon, authenticated;
revoke truncate, trigger on table public.exercise_states from public, anon, authenticated;
