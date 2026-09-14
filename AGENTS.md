# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Runtime regression guardrails

All RussiCaptor Runtime Regression Guardrails are mandatory acceptance gates. Before implementing a feature, classify its impacts using `docs/RUNTIME_REGRESSION_GUARDRAILS.md`, preserve every affected invariant, and run the documented guardrail groups plus required release checks. Never weaken, bypass, delete, silently redefine, or threshold-relax a guardrail; report an architectural conflict explicitly before release.
