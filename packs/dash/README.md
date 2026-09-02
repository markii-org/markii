# dash

Dashboard and monitoring components: trend lines, gauges, status dots,
uptime history, and change indicators. Every shape is hand-rolled SVG or
CSS, with no charting library.

| Directive            | Form   | Description                                     |
| -------------------- | ------ | ----------------------------------------------- |
| `::dash_sparkline{}` | leaf   | Trend line for a bound numeric series.          |
| `::dash_gauge{}`     | leaf   | Semi-circular arc gauge for a value in a range. |
| `:dash_status[]{}`   | inline | Colored status dot next to a label.             |
| `::dash_uptime{}`    | leaf   | Segmented bar of an ok/warn/down history.       |
| `:dash_delta[]{}`    | inline | Up/down triangle with a formatted change.       |

Where a component reads both a `data=` binding and an attribute of the same
name, the written attribute wins. That matches `@markii/react`'s own
`progress` and `stat`, and it lets you pin a value while a script is still
being written.

## `dash_sparkline`

<img width="1088" height="403" alt="image" src="https://github.com/user-attachments/assets/2151346a-804c-4642-99e2-55704c8a7987" />

```markdown
::dash_sparkline{data=metric label="CPU"}
```

Attributes:

- `label` (string, optional): caption shown next to the last value.

Bound data: an array of finite numbers, an array of `{value}` objects, or
`{values: [...]}`. Anything else, or no binding, renders a quiet empty
dash. The line auto-scales to the series' own range, and a flat series sits
on the mid-line. At most 120 points are drawn.

```json
[12, 14, 13, 18, 22, 19]
```

## `dash_gauge`

<img width="1088" height="403" alt="image" src="https://github.com/user-attachments/assets/0a824077-e520-4a5b-9b61-77dcda092230" />

```markdown
::dash_gauge{data=cpu min=0 max=100 label="CPU" unit="%"}
```

Attributes:

- `min` (number, optional): range minimum. Defaults to 0.
- `max` (number, optional): range maximum. Defaults to 100.
- `value` (number, optional): the value to show. Wins over the binding.
- `label` (string, optional): caption below the arc.
- `unit` (string, optional): suffix appended to the value, such as `%`.

Bound data: a finite number, or an object with a finite `.value` field. The
value is clamped into `[min, max]`. A range that is empty, or too wide to
measure, draws an empty arc rather than a misleading full one.

```json
{ "value": 63 }
```

## `dash_status`

<img width="1088" height="403" alt="image" src="https://github.com/user-attachments/assets/2b64a0af-dedb-4400-9f62-26bd9bf41d4e" />

```markdown
:dash_status[api server]{state=ok}
```

Attributes:

- `state` (string, optional): `ok`, `warn`, or `down`. Anything else, or
  nothing at all, renders a neutral unknown dot.

The directive's text is the label. A `data=` binding that resolves to a
string overrides `state`, for a status a script produces rather than one
you type. A failed binding keeps the attribute's state and adds only a
tooltip.

```json
"warn"
```

## `dash_uptime`

<img width="1088" height="403" alt="image" src="https://github.com/user-attachments/assets/306b8218-1c5e-4456-a0cc-473a27f1dc7a" />

```markdown
::dash_uptime{data=history label="API"}
```

Attributes:

- `label` (string, optional): caption above the bar.

Bound data: an array of strings, each `ok`, `warn`, or `down`, oldest entry
first. An entry that is none of those renders as a neutral unknown segment
rather than being dropped, so the bar's length still matches the real
history. The bar keeps the 90 most recent entries.

```json
["ok", "ok", "warn", "ok", "down", "ok"]
```

## `dash_delta`

<img width="1088" height="403" alt="image" src="https://github.com/user-attachments/assets/0360de25-2bfe-4b11-ab5c-e12734a80c14" />

```markdown
:dash_delta[error rate]{value=-3.2 unit="%"}
```

Attributes:

- `value` (number, optional): the change to show. Wins over the binding.
- `unit` (string, optional): suffix appended to the value, such as `%`.

The directive's text is a label printed after the number. Write one: an
inline directive left with empty brackets is flagged by the renderer as an
authoring mistake, with a dashed underline and a tooltip.

Bound data: a finite number, or an object with a finite `.value` field.
Positive renders green, negative red, zero neutral.

```json
{ "value": -1.4 }
```
