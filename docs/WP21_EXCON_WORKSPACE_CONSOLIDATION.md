# WP-21 — ExCon Workspace Consolidation

## Outcome

The existing exercise-management experience is consolidated under the Exercise
Controller (ExCon) workspace. This work package changes presentation,
navigation terminology, and role documentation only.

## Primary application workspaces

| Workspace | Responsibility | Runtime access |
|---|---|---|
| Case Manager | Patient identification and clinical workflow | Existing validated application services |
| Exercise Controller (ExCon) | Exercise overview, resources, patient inspection, and event injection | Read-only canonical snapshots; event injection through the existing validated command boundary |

“Instructor Console” is superseded by Exercise Controller in user-facing text.
Stable internal `Instructor*` models and services remain unchanged where renaming
would add risk without changing behavior.

## Navigation

```text
Exercise Controller (/excon)
  -> Exercise Dashboard (/excon/dashboard)
    -> Patient Inspector (/excon/patient/:id)
      -> Inject event
```

The established `/excon` routes remain stable. Patient Inspector uses stack back
navigation so the existing Dashboard instance retains its filters, selected list
state, and scroll position.

## Architecture invariants

- Dashboard, Resource Monitor, and Patient Inspector remain read-only.
- Event Injection remains the only ExCon write-capable action.
- Commands continue through the existing typed validator, handler, runtime-owner,
  PatientProcess, aggregation, and canonical snapshot path.
- No polling or additional runtime subscriptions were added.
- No RuntimeState, ScenarioEngine, PatientProcess, ResourcePool, Golden, replay,
  or clinical behavior was changed.

## Compatibility

- Existing ExCon deep links remain valid.
- Internal Instructor-prefixed command contracts remain compatible.
- Historical ADRs and work-package reports are not rewritten.
