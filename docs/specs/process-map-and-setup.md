# Spec: process map and setup
Problem: turn step timestamp columns into a directly-follows map against a happy flow.
Acceptance criteria:
- `suggestConfig` proposes column roles; personal-looking headers are ignored by default.
- `buildModel` and `deviations` name steps missing, added or out of order against the reference flow.
- `renderMapSvg` draws the map from the model.
Tests: `tests/core.test.mjs`, `tests/hf.test.mjs` (`npm test`).
