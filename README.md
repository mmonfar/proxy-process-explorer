# Proxy Process Explorer

**Status: Prototype.** Built and tested on synthetic data only.

A single HTML file that turns a spreadsheet of step timestamps into a process view: a map of how cases actually moved through the steps, how long each wait took, where cases left the expected path, and which groups differ. It runs offline in the browser. Nothing is uploaded.

![A synthetic discharge process loaded in the explorer](docs/screenshot.png)

## Why "proxy" process mining

Process mining proper starts from an **event log**: one row per event, with a case ID, an activity name, a timestamp and usually a resource (who did it). From that log you can discover a process model, replay cases against it and measure conformance, rework and hand-offs between people.

Many operational extracts are not shaped like that. They hold **one row per case and one timestamp column per step** (order placed, medicines reconciled, summary written, patient discharged). That is enough to:

- sort each case's steps into a sequence and count the distinct sequences (variants);
- draw a directly-follows graph (which step came straight after which, how often, how long the gap was);
- compare every case with a reference flow and name what was missing, added or out of order;
- measure time from the start step to every other step, and find the step most often completed last.

It is not enough to:

- see a step that happened twice (rework or loops), because each step has one column and one timestamp;
- know who did a step, so hand-offs between people or teams cannot be measured;
- discover a process model or check conformance against one in the formal sense. "Followed the reference flow" here means the same steps in the same order, nothing missing or added.

This tool does the first list honestly and says so on every slide it exports. For the full event-log approach (a canonical pseudonymous event stream, process discovery, conformance and resource analysis), see the companion project **Hospital ward process mining model**, which is the reference architecture for this scaffold.

## Quick start

1. Open `dist/process_explorer.html` in a current browser (Edge, Chrome or Firefox). No install, no server.
2. Click **Try the synthetic sample**, or load your own `.csv` or `.xlsx`.
3. Walk through the setup:
   - **Columns**: each column gets a role (step timestamp, case ID, variable, delay reason, due date, or ignore). Roles are suggested from the values. Columns whose names look like personal data (names, dates of birth, record numbers, contact details) are ignored by default.
   - **Happy flow**: put the steps in the order they should happen and tick the ones that belong to the expected path. The first ticked step starts the clock; the last ticked step ends the case.
   - **Variables**: tick the variables that are relevant for risk.
4. Explore the tabs, then **Export slides (.pptx)** for a report built from the current filters.

**Export setup (.json)** saves the choices. Import it next month and the same file layout is set up in one click. The last setup used for a file layout is also remembered in the browser.

## What your file should look like

| case_id | unit | order_at | step_b_at | … | finished_at | delay_reason |
|---|---|---|---|---|---|---|
| C-001 | Unit A | 2026-03-02 09:10 | 2026-03-02 10:05 | … | 2026-03-02 13:40 | Awaiting transport |

- One row per case. Column names are free.
- At least two timestamp columns. Dates can be real spreadsheet dates or text such as `2026-03-02 09:10`, `02/03/2026 9:10` or `2 Mar 2026 09:10`. Day/month order is detected.
- The header row can sit below report titles.
- Rows without a time in the end step are left out and counted in the data checks.

## The setup file

The setup is one plain JSON document. The sample one is [`samples/synthetic_discharges.setup.json`](samples/synthetic_discharges.setup.json). Its schema is described in [`docs/CONFIG.md`](docs/CONFIG.md).

## Privacy and security

- The page carries a Content Security Policy that blocks every network request (`connect-src 'none'`, no external scripts, fonts or images). A loaded file stays in the tab's memory and is gone when the tab closes.
- Slides contain aggregate figures only. Case lists and the case lookup show case IDs; use an ID column that is not a patient identifier, or leave the ID unset.
- Exported `.pptx` files carry the report title and the tool name in their document properties, and no author, company or file path.

## Sample data

`samples/` holds a synthetic discharge process: 1,200 made-up cases from a seeded generator (`synthRows(42, 1200)` in `src/core.js`). Every case ID starts with `SYN-`. The delay reasons follow categories that appear across the published literature on delayed hospital discharge (medicines to take home, transport, results, senior review, family, community care, placement, documentation). No real record was used to build them.

## Build and test

Node 20 or later, no dependencies.

```bash
npm run build     # src/ -> dist/process_explorer.html (one self-contained file)
npm run samples   # regenerate samples/ from the seeded generator
npm test          # node:test suite
```

`src/core.js` holds all parsing and analysis as pure functions, and the tests drive it from the setup file, not through the page. `tests/traces.test.mjs` scans every file in the repository, the sample workbook and an exported deck for a list of terms that must never appear. The terms are stored only as hashes.

## Layout

```
src/core.js         parsing, column profiling, setup, analysis, SVG charts, PPTX writer, synthetic generator
src/ui.js           setup wizard and explorer tabs
src/styles.css      page styles
src/index.html      page template
build.mjs           inlines the above into dist/process_explorer.html
tools/make_samples.mjs
samples/            synthetic CSV, XLSX and setup file
tests/              node:test suites
```

## Reading

- W. M. P. van der Aalst, *Process Mining: Data Science in Action*, 2nd ed., Springer, 2016. Event logs, directly-follows graphs, discovery and conformance.

## Licence

MIT. See [LICENSE](LICENSE).
