# Proxy Process Explorer - Software Design Document

## Purpose
Turn a spreadsheet with one row per case and one timestamp column per step into a process view: how cases moved through the steps, how long each wait took, where cases left the expected path, and which groups differ (see README, "Why proxy process mining"). It runs offline in the browser; nothing is uploaded.

## Scope
In scope: CSV and XLSX reading, column roles, happy flow, rules (four types), directly-follows map, timing, risk factors with a logistic model, funnel plot by group, a self-playing hero demo, and a .pptx export. Out of scope: event logs with repeated steps, who did a step, formal process discovery or conformance. Status: prototype.

Synthetic data only. Not a medical device. Not for clinical decision-making.

## Contract / interfaces
All analysis is pure functions in `src/core.js` (no DOM, no network), exported with `module.exports` and used by the page and by the Node tests.

- Input: `parseCsv`, `readXlsxRows`, `toTable`, `profileColumns`, `suggestConfig`, `mergeConfig`, `normaliseConfig`, `validateConfig`, `isPiiHeader`.
- Model: `buildRecords`, `prepare`, `buildModel`, `layoutOrder`, `deviations`, `analyse`.
- Rules and risk: `evalRule`, `applyRules`, `ruleSummary`, `riskFactors`, `factorTable`, `logitModel`, `groupVariation`, `openAtDeadline`, `riskAnalyse`.
- Output: `renderMapSvg`, `renderTimingSvg`, `renderRulesSvg`, `renderForestSvg`, `renderVariationSvg`, `buildDeck` (.pptx).
- Sample: `synthRows`, `SAMPLE_CONFIG`.
- Setup file: JSON config, exported and re-imported by the page.
- Hero demo: `src/demo/facts.mjs` (`buildFacts` runs the engine at build time), `src/demo/timeline.js` (pure state function), `src/demo/demo.html`, `demo.js`, `demo.css`.
- Build: `npm run build` writes `dist/process_explorer.html` and `dist/demo.html`.

## Acceptance criteria
1. The sample loads and every tab shows results; no data leaves the browser.
2. A rule returns met, breach, or not evaluable when a needed step is missing.
3. Columns whose names look like personal data are ignored by default.
4. Demo counters come from the engine and never show NaN; the final values equal the engine's.
5. No repository file carries a personal trace (privacy test).
6. Colours in the source pages use brand tokens (product gate brand linter: 0 findings). The process map keeps two labelled semantic colours (skip, alert) defined in `src/demo/demo.css` and `src/core.js`.

## Tests
Command: `npm test` (`node --test "tests/*.test.mjs"`).
Last run (7 Nov 2026): 48 tests, 47 pass, 1 fail. Files: `core.test.mjs`, `rules.test.mjs`, `demo.test.mjs`, `hf.test.mjs`, `traces.test.mjs`.
The one failure is "no repository file carries a trace": its text scan reports 1-gram hits inside the binary `docs/media/teaser.mp4`. It is not caused by this change.

Specs: see `docs/specs/`.
