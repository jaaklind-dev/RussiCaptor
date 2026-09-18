-- WP-NARVA-10B30Q: canonical writer publications can legitimately exceed the
-- hosted authenticated role's 8 second statement timeout once a long-running
-- exercise reaches a roughly 10 MB canonical checkpoint. Keep the exception
-- local to the authority-critical publication RPCs. CAS, lease, delta and
-- reconciliation semantics remain unchanged.

alter function public.publish_runtime_checkpoint_canonical_payload(
  uuid,text,bigint,text,bigint,integer,text,text,integer,text
) set statement_timeout = '60s';

alter function public.publish_runtime_checkpoint_canonical_payload_delta(
  uuid,text,bigint,jsonb,text,bigint,integer,text,text,integer,text
) set statement_timeout = '60s';

-- Retain the same bounded allowance for rollout fallbacks. These functions
-- carry both structured and canonical representations and are therefore no
-- cheaper than the canonical-primary path.
alter function public.publish_runtime_checkpoint_canonical(
  uuid,text,bigint,jsonb,integer,text
) set statement_timeout = '60s';

alter function public.publish_runtime_checkpoint_canonical_delta(
  uuid,text,bigint,jsonb,jsonb,integer,text
) set statement_timeout = '60s';

-- B15 introduced canonical-primary terminal wrappers after the original
-- terminal timeout migration. Apply the same already-accepted terminal bound
-- to those wrappers without changing their atomic completion behavior.
alter function public.finalize_runtime_completion_canonical_payload(
  text,text,uuid,text,bigint,bigint,integer,text,text,integer,text
) set statement_timeout = '60s';

alter function public.finalize_runtime_completion_canonical(
  text,text,uuid,text,bigint,jsonb,integer,text
) set statement_timeout = '60s';
