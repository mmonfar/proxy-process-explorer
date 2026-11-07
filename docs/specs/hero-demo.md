# Spec: hero demo
Problem: a short self-playing page that shows the explorer on the synthetic sample.
Acceptance criteria:
- `buildFacts` runs the real engine at build time; the page only plays the results back.
- `src/demo/timeline.js` is one pure state function; counters never show NaN.
- Works offline, with keyboard buttons and reduced motion.
Tests: `tests/demo.test.mjs` (`npm test`).
