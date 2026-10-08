# Human-factors review, proxy process explorer (8 Oct 2026)

Method: Playwright, sample loaded, all 7 tabs at 1280x800 and 390x844, before and after. Stills in `docs/hf-review-2026-10/`. Engine untouched. Bach 2022 = wiki "Dashboard Design and UX".

## Findings and fixes

| # | Finding | Severity | Principle | Status |
|---|---|---|---|---|
| 1 | Landing: narrow card, left-aligned, three equal buttons, long paragraph, "Expected shape" table always open | major | Bach: stratified layout, one obvious first action | Fixed: centred hero, one large "Try the synthetic sample", file/setup buttons secondary, file-shape help in a details block |
| 2 | Operated by instruction paragraphs (rules, breakdown, factors, map, lookup, selection) | major | Recognition over recall; Bach: detail-on-demand | Fixed: one short line per panel; breach counts are now buttons labelled "Show 418"; rule rows and breakdown rows get hover affordance; long map explanation moved under "How to read this map"; lookup placeholder says what to type |
| 3 | No persistent view of filters or case count; 6 KPI tiles pushed results down | major | Bach: parameterisation + meta information; visibility of system status | Fixed: sticky bar with filters, one-line summary ("42 of 1,197 discharges, 14% followed the happy flow, slowest step X"), active-filter chips, Clear all (only when filtering), Match all/any (only with 2+ filters). Pure `contextSummary()` in core.js, 5 tests. KPIs compacted to one row |
| 4 | Filters and result not visible together: chrome took ~400 px | major | Bach: screen fit | Fixed: chrome now ~180 px, sticky ~120 px; map keeps a readable 480 px floor |
| 5 | Phone: KPI tiles unreadable, tab strip overlapped, 5 filters stacked, map clipped | major | One-hand, point-of-care use (OPERATING_MODEL §9) | Fixed: scrollable tab strip, collapsible "Filters (n)" button, KPI strip scrolls sideways, rules table keeps Rule/Met/Show columns, grid children min-width 0. No horizontal page scroll at 390 px |
| 6 | Privacy bar plus data warning boxes used two tall bands | minor | Economy | Fixed: header pill on landing, one-line data note (details if several) |
| 7 | Default tab | minor | | Kept Process map; the summary line now carries the headline |

## Left for later

- Map text is still small at 1280x800 (about 70% scale); an "Actual size" scroll is available. A vertical-compact map layout would need an engine change.
- Timing, Time of day, Findings tabs still scroll vertically for lower cards (acceptable: filters stay sticky).
- No keyboard-focus audit or WCAG contrast pass (WCAG is a "later" row).
- Executive-alone test with a real first-time user not run; CEO to try the landing once.
- Downstream sweep: README screenshot refreshed (`docs/screenshot.png`); the demo and the LinkedIn visuals were not re-made.

Checks: node:test 46/46 (5 new), build OK, histscan CLEAN, brand_check findings unchanged (labelled alert/skip constants at styles.css line 6).
