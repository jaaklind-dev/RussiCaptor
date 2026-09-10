-- WP-NARVA-10A1: terminal completion is the only authenticated RPC that must
-- atomically persist both a full Runtime checkpoint and its exercise
-- projection. A representative 15-16 MB terminal payload can legitimately
-- exceed the hosted `authenticated` role's 8 second statement timeout even
-- though the transaction is bounded to one exercise and uses primary-key row
-- locks. Keep the exception local to this authority-critical function; do not
-- change the database or authenticated-role default.

alter function public.finalize_runtime_completion(text,text,uuid,text,bigint,jsonb)
  set statement_timeout = '60s';
