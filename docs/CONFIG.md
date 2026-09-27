# Setup file (`proxy-process-explorer/config@1`)

The setup wizard writes one JSON document. You can export it from the page, edit it by hand, keep it next to the data it describes, and import it again. Tests load the sample setup directly, without the page.

```json
{
  "schema": "proxy-process-explorer/config@1",
  "name": "Discharge process",
  "terms": { "case": "discharge", "cases": "discharges" },
  "columns": {
    "case_id":            { "role": "id",        "label": "Case ID" },
    "unit":               { "role": "attribute", "label": "Unit", "type": "cat", "risk": true },
    "age":                { "role": "attribute", "label": "Age",  "type": "num", "risk": true },
    "expected_discharge_date": { "role": "due",  "label": "Expected discharge date" },
    "discharge_order_at": { "role": "step",      "label": "Discharge order" },
    "discharged_at":      { "role": "step",      "label": "Discharged" },
    "other_delay_reason": { "role": "reason",    "label": "Other delay" },
    "free_text_note":     { "role": "ignore",    "label": "Free text note" }
  },
  "stepOrder": ["discharge_order_at", "discharged_at"],
  "happyFlow": ["discharge_order_at", "discharged_at"],
  "rules": [],
  "settings": { "weekend": [6, 0], "basis": "start" }
}
```

## Fields

| Field | Meaning |
|---|---|
| `schema` | Always `proxy-process-explorer/config@1`. |
| `name` | Process name, used in titles and file names. |
| `terms.case`, `terms.cases` | What one case and many cases are called in the page and slides ("discharge", "referral", "order"). |
| `columns` | One entry per column header in the file, keyed by the exact header text. |
| `columns.*.role` | `step` (a timestamp for one step), `id` (case ID, at most one), `attribute` (a variable for filters, breakdowns and risk), `reason` (delay reason, counted as recorded), `due` (a due date, at most one), `ignore`. |
| `columns.*.label` | The name shown in the page and slides. |
| `columns.*.type` | Attributes only: `cat` (category) or `num` (number, compared in quarter bands). |
| `columns.*.risk` | Attributes only: `true` to use the variable as a candidate risk factor. |
| `stepOrder` | All step columns in display order. |
| `happyFlow` | The ordered subset of steps that make up the expected path. The first one starts the clock; the last one ends the case, and rows without it are left out. At least two. |
| `rules` | Timing and ordering rules. See the rules section when present. |
| `settings.weekend` | Weekend days, `0` = Sunday … `6` = Saturday. |
| `settings.basis` | Whether day and hour come from the `start` or the `end` step. |

## Importing onto a different file

When a setup names columns the file does not have, those columns are dropped and listed, steps missing from the file leave the happy flow, and rules that refer to a missing step are left out. New columns in the file get suggested roles.
