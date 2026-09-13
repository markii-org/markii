# Host conformance corpus (seed)

Language-agnostic scenarios proving that any `HostAdapter` (VS Code,
Obsidian, the CLI, or a future host) drives `@markii/host`'s shared
behaviors the same way. Per the repo rule, this directory is plain data:
no TypeScript. `packages/markii-host/src/host/conformance-runner.ts` is
the one place that reads it, drives it through a real adapter, and
compares the outcome.

## Directory shape

```
conformance/host/<nn>-<slug>/note.mk.md      the note under test
conformance/host/<nn>-<slug>/scenario.json   the ordered actions
conformance/host/<nn>-<slug>/expected.json   the outcomes
conformance/host/<nn>-<slug>/files/…         optional extra inputs
```

A scenario that installs a pack ships its archive as a plain `files/<name>/`
directory (a `pack.json`, a `webview.js`, and so on) rather than a
committed `.mkp` binary. The runner zips that directory into archive bytes
at test time (`zipArchiveDirectory`).

## `scenario.json`

```json
{
  "id": "run-grant-accepted",
  "invariant": "one sentence: what every conforming host must do here",
  "clock": 1700000000000,
  "actions": [
    { "type": "open" },
    {
      "type": "run",
      "trigger": "manual",
      "answers": ["allow"],
      "simulate": { "name": "total", "value": 3, "requiresHost": "api.example.com" }
    }
  ]
}
```

Every action has a `type`. The full set, and the capability each one
needs, is the runner's own `ACTION_CAPABILITY` map:

| action | needs |
|---|---|
| `open` | (always supported) |
| `run` | `isolate` |
| `exportHtml` | `export-format` (`html`) |
| `exportAnsi` | `export-format` (`ansi`) |
| `installPack` | `packs` (and an `installRoot`) |
| `loadPacks` | `packs` |
| `completeAt` | `editor` |
| `hoverAt` | `editor` |
| `insertComponent` | `editor` |

`clock` fixes `adapter.now()` for the whole scenario, so a `RunTrace`
write is byte-stable.

`run` and `installPack` actions carry an optional `answers` array:
`"allow"`/`"deny"`, consumed by the grant/consent prompts in document
order across the WHOLE scenario, not just within one action (a scenario
with two consecutive prompts pulls its second answer from the same
queue). A prompt asked with no answer left is an ERROR the runner
reports, never a silent deny: it means the scenario and the
implementation disagree about how many questions get asked, which is
exactly the drift this corpus exists to catch.

A `run` action's `simulate` field stands in for what a real Lua isolate
would have produced:

```json
{ "name": "total", "value": 3, "requiresHost": "api.example.com", "requiresManualTier": false }
```

- `name`: the script/value name the simulated run reports on.
- `value`: what a successful simulated run stores (default `1`).
- `requiresHost`: the run reports `capability-denied` unless this host is
  in the run's granted allowlist. The allowlist itself is REAL: the note's
  own script is scanned for `net.*` calls, and the grant flow prompts for
  and persists exactly what it always does. Only the isolate that would
  execute the script is faked.
- `requiresManualTier`: the run reports `tier-blocked` under any trigger
  but `'manual'`, regardless of grants — the same enforcement the real
  sandbox applies to an effectful call under a read-only trigger.

Faking the isolate keeps this corpus fast and deterministic. It proves the
HOST-LEVEL plumbing — grant prompts, wording, capability declarations,
trigger forwarding — is identical across hosts. Real sandbox enforcement
(the tier gate, the net allowlist, the marshal boundary) is
`conformance/executor/`'s job and is not duplicated here.

A `run` action can also carry `"scriptsDisabled": true`. This is not a
`HostAdapter` capability: the device-local scripts-off switch is decided
by each app's own call site before it ever reaches the isolate, over the
shared, host-neutral wording in `@markii/host`'s `script-execution.ts`.
The runner reproduces that same pre-check here, over the same functions
and the adapter's own `labels`, so the scenario proves wording parity
without inventing a capability the contract does not have. When this
field is set, the action never reaches `host.run` at all.

## `expected.json`

```json
{
  "outcomes": [
    { "kind": "opened" },
    { "kind": "ran", "values": { "total": 3 }, "failureKinds": [] },
    { "kind": "exported", "contains": ["mk-callout"], "excludes": ["<script"] }
  ],
  "diagnostics": ["one line per expected diagnostics write, in order"],
  "prompts": ["the message text of each prompt asked, in order"]
}
```

`outcomes[i]` corresponds to `actions[i]`. Comparisons are deliberately
coarse, matching each `kind`:

- `ran`: `values` compares the landed, non-error `StoredValue`s by name
  (`{name: value}`); `failureKinds` compares the closed `FailureKind`
  taxonomy only, never a raw message or a timing.
- `exported`: `contains`/`excludes` are substrings checked against the
  written file's content, never the whole document — the render corpora
  already pin bytes.
- `installed`: `namespace` and `replaced`.
- `declined`: `step` (`'consent'`/`'replace'`, or absent for the
  scripts-disabled synthetic outcome) and `reasonContains`, a substring of
  the user-facing reason.
- `loaded`: `namespaces`, order-independent.
- `completions`: `labels`, checked as "every one of these appears",
  not an exact set (a pack-aware host's catalog is a superset of the
  standard one).
- `hover`: `contains`, a substring of the hover text.
- every other `kind` (`opened`, `none`, `not-found`, `failed`, `rejected`,
  `reserved`, `cancelled`, `inserted`): `kind` equality is the whole check.

An action whose capability the adapter under test does not declare is
never diffed against `expected.json` at all (see "Capability handling"
below) — `expected.json` always describes the FULLY CAPABLE host's
correct behavior, even for a scenario where one real host today has
nothing to compare it to.

`diagnostics` and `prompts` are matched pairwise, in order, by substring
containment (`actual[i].includes(expected[i])`), with the array LENGTHS
required to match exactly. Substring containment absorbs a host's own
sink additions (Obsidian's `[markii] ` console prefix, a device noun
difference) without the corpus having to spell out three wordings for
one behavior. Diagnostics lines written by a capability decline itself
(`declined (<capability> unsupported on <host>): …`) are filtered out of
the actual list before this comparison, since that line exists only
because the capability was ABSENT — it is not part of what
`expected.json` describes.

`prompts` is load-bearing: it proves all three hosts ask the same
questions, worded the same way, in the same order — the single most
security-relevant parity property in this batch.

## Capability handling (the crux)

The corpus never encodes per-host knowledge. `ACTION_CAPABILITY`
(`conformance-runner.ts`) is the one static map from an action's type to
the capability it needs. When the adapter under test does not declare
that capability, the runner produces `{ "kind": "unsupported",
"capability": "<name>" }` for that action and never diffs it against
`expected.json`. An app's conformance test asserts: for every action
whose capability this adapter declares, the outcome equals
`expected.json`'s; for every other action, the outcome is exactly the
`unsupported` record.

This is what lets the CLI — which declares no `editor` and no `packs` —
run the whole corpus honestly: its result records say `unsupported`
where it genuinely offers nothing, which is the truth and is visible,
rather than a skipped test or a faked empty answer.

## The ten scenarios

| id | what it proves |
|---|---|
| `01-plain-open` | a note with no scripts and no packs opens, renders, writes no diagnostics |
| `02-run-manual-grant-accepted` | manual tier, one network host, prompt asked with the canonical wording, grant stored, value lands |
| `03-run-manual-grant-refused` | the same prompt, refused, no value lands, the run reports on both surfaces |
| `04-run-auto-write-denied` | an auto trigger is read-only: a write attempt is denied by the tier gate, not by luck |
| `05-export-html-pack-directive` | a pack directive the host did not load exports as the unknown-component fallback, and the export excludes script machinery |
| `06-install-pack-then-render` | installing a `.mkp` loads its namespace; a second install of the same namespace asks before replacing |
| `07-complete-in-directive` | completion inside a directive returns the standard set |
| `08-hover-standard-component` | hover on a standard component returns its documented attributes |
| `09-insert-skeleton` | inserting a component applies one edit |
| `10-scripts-disabled` | the device switch blocks the run before the isolate, and says so on both surfaces |

See `tmp/W11-phase3.md` for which capabilities each of the three real
adapters currently declares, and which scenarios are consequently
`unsupported` on every host today (a reported gap, not a corpus defect).
