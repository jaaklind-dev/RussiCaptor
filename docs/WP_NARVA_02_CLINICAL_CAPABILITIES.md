# WP-NARVA-02 clinical capabilities

WP-NARVA-02 completes the production Runtime capabilities required by the Narva trauma and IRO packages.

## Authoritative models

- TXA derives its trauma-window classification from the fixture's simulation-clock injury onset.
- `FIBRINOGEN_CONCENTRATE` (`FIBRYGA` display alias) is an explicit gram-dosed coagulation product. It corrects only an opt-in fibrinogen substrate deficit; it is independent from TXA fibrinolysis and source control.
- Propofol, midazolam, and rocuronium use the existing medication/CNS administration lifecycle. Hypnosis and neuromuscular blockade are independent dimensions. RASS, BIS, and train-of-four are deterministic observations, not authoritative drug state.
- The IRO fixture materializes an ETT, volume-control ventilation, two vascular accesses, norepinephrine, propofol, remifentanil, and rocuronium directly into the same canonical states used by live treatment.

## IRO scenario process

The package-bound IRO Runtime implements explicit vasopressor and ventilation fault triggers, simulation-time deterioration, HOLD/RESUME, correction/recovery, combined-fault acceleration, PEA through the existing cardiac-arrest process, and cause-gated ROSC. ROSC requires arrest, quality CPR evidence, and correction of every active scenario cause; medication or elapsed time alone cannot grant it. Successful ROSC leaves a new GO/NO-GO decision pending.

The treatment palette remains broad. Clinically questionable but technically valid choices are representable; malformed doses, routes, units, access, and device references fail closed.

## Compatibility boundary

All new checkpoint fields are optional when unused. Non-Narva scenarios do not create IRO state, injury-time state, or fibrinogen definitions. Checkpoint authority, canonical hashing, CAS, leases, heartbeat, Realtime, publication, recovery, and completion are unchanged.
