# RussiCaptor live-operations recovery runbook

Use **EXCON → Diagnostika ja taastamine** first. Never repair a live exercise with SQL, row deletion, a service-role key, or local app-data deletion.

## CM says the patient belongs to another user

1. Confirm the displayed current owner and network state.
2. If ownership is correct, use the supported transfer request; do not repeat the mutation.
3. If the screen is stale, restore connectivity and refresh authoritative state.
4. A stale-owner rejection means no write was accepted. Do not bypass ownership.

## Device lost internet

1. Stop privileged changes when the UI says reconnect is required.
2. Check mobile/Wi-Fi connectivity without clearing application data.
3. Reopen diagnostics and choose **Värskenda autoriteetne seis**.
4. Continue only after Realtime/backend and authorization are healthy.

## Runtime writer tablet died

1. On another authorized EXCON device, check lifecycle, checkpoint revision, writer and lease expiry.
2. If a valid checkpoint exists and the old lease is no longer authoritative, choose **Võta Runtime üle**.
3. If a revision conflict is reported, choose **Taasta pilve kontrollpunktist**.
4. Never release or edit a lease manually.

## Exercise is RUNNING but Runtime does not recover

- **Valid checkpoint:** use supported takeover/recovery.
- **Missing checkpoint:** Runtime is unrecoverable without fabricating state. An EXCON with `EXERCISE_RUNTIME_RECOVERY` may use the audited **Lõpeta katkine õppus** action.
- **Permission denied:** do not retry with another local identity. Use a pre-authorized EXCON or administrative role-assignment workflow.
- **Backend unavailable:** wait or switch network/device; do not create local authority.

## Application shows stale/conflict

Refresh authoritative state. If the issue is a checkpoint revision conflict, use remote-checkpoint recovery. If another writer owns the lease, remain reader or perform authorized takeover after verifying the device-loss situation.

## EXCON device died

Sign in on the prepared spare EXCON tablet with an already scoped operator account, open diagnostics, verify the current exercise and checkpoint, then use supported takeover if required. The old physical device is not a permanent authority source.

## Backend does not respond

Clinical viewing may continue only as clearly stale/degraded information. Stop authority-changing actions, document the interruption, switch the network if available, and wait for convergence. If the outage exceeds the exercise safety plan, follow the exercise director’s stop procedure.

## Escalation

Administrator/developer intervention is a last resort after the exercise has been made operationally safe. Preserve diagnostics export and audit evidence; never give field devices elevated keys.
