# Narva procedure availability physical acceptance

This gate remains deferred until a physical Samsung is available.

1. Start a fresh `russicaptor.narva-trauma@1.0.3` exercise through supported scoped authorization.
2. On `PT-PELVIC-001`, verify pelvic binder is available, chest drainage is absent, and the existing treatment/MTP palette remains present.
3. On `PT-CHEST-001`, verify chest drainage is available, pelvic binder is absent, and airway, treatment, and MTP actions remain present.
4. Cold-restart and verify the same availability without duplicate state.
5. With a second physical client, verify its projection matches and its commands still route through the sole writer.

Do not use direct backend mutation or an unauthorized-command attempt as part of the physical UI gate.
