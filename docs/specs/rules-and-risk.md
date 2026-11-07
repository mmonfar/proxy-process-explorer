# Spec: rules and risk
Problem: show which share of cases meets an expectation, and which factors go with a breach.
Acceptance criteria:
- `evalRule` gives met, breach, or not evaluable.
- `factorTable` gives rates with and without each factor and a 95% interval.
- `logitModel` needs at least 50 complete cases and 10 events on each side; otherwise no model.
Tests: `tests/rules.test.mjs`, `tests/core.test.mjs` (`npm test`).
