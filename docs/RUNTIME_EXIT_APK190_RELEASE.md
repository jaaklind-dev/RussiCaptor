# APK190 / 1.2.3 — bounded physical candidate

Applies only the frozen local runtime-exit retry correction v2 identified by
manifest SHA-256 f2988f814f1bc14e23baab315f4286f8617dbb80c5b93ddfead92f82e1e95780,
plus monotonic release metadata. Package content, Imaging 420/600-second timing,
backend/SQL, roles and native heartbeat implementation are unchanged from APK189.

Existing stable production signer and data-preserving update required. Canonical
build excludes diagnostic-only/fault-input mechanisms; the new bounded,
payload-free runtime-exit failure entries are operational support evidence, not
a validation switch. No functional failure injection is included.

This is not an operational release decision. Required local release checks,
device identity and one authorized TEST mode-transition/staged Imaging/restart
acceptance plus cleanup must be recorded separately. The original APK189 first
physical mode-transition failure trigger remains unproven; no retroactive PASS.
