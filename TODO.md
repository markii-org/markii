# TODO — 0.1.x / 0.2 upgrade session

Authoritative, persistent work queue for the upgrade session. If a session resets
or context is lost: re-read `CLAUDE.md` → `DESIGN.md` → this file, then continue
top-down. `DESIGN.md` is the source of truth for *what the format is*; this file
only tracks *work state*. Mark items `[x]` as they land, with the commit hash.

## Ground rules (binding, from CLAUDE.md + session agreements)

- The orchestrator (top session) is the only one who runs git. Subagents never
  commit, branch, or init — they report changes.
- Delegation model: an Opus 5 subagent may orchestrate Sonnet 5 workers that do
  the implementation. All worker output gets **adversarial** verification (probe
  for prototype-name directives, hostile attribute values, XSS via attributes,
  never-throw guarantees) — not confirmatory review.
- **Rotate the Opus orchestrator between phases**: finish a phase, get its
  report, then spawn a *fresh* orchestrator with a distilled brief for the next
  phase. Never let one orchestrator accumulate a large context.
- Gates before every commit, from repo root, with real output:
  `npm test` · `npm run build` · `npm run lint`.
- TS strict, no `any`/`@ts-ignore`; named exports; Vitest colocated; every
  parser-visible behavior gets a conformance fixture.
- Invariants that are never up for negotiation: unknown directives never throw;
  the parser stays component-agnostic; directive syntax stays
  non-Turing-complete; components own their insides only; rendering never
  executes scripts.

## Phase A — spec-edit pass (docs only, orchestrator-owned) — DONE

All items below were findings of the 2026-08-17 design review, **explicitly
user-approved**. Edit DESIGN.md accordingly:

- [x] A1 (hygiene) §2: registry example says "props = zod schema" — zod is not
      in the stack; refer to the neutral attribute-schema idea (@markii/stdlib).
- [x] A2 (F2) §3: acknowledge that inline `:value[...]` interpolation is the
      worst-degrading construct (literal directive syntax mid-sentence in plain
      viewers); guidance: prose meant to travel should prefer component bindings.
- [x] A3 (F4) §4: add `:::row{cols=2|3|4}` to the closed layout-preset set —
      equal cells, responsive wrap, stacks on narrow viewports and in plain
      viewers; no spans, no heights, no freeform values.
- [x] A4 (tidy) §5: add "a note never references a pack by filesystem path;
      packs are app-installed and referenced by namespace."
- [x] A5 (tidy + F5-footgun) §5: new "Vaults and the vault library" subsection —
      vault = plain directory of notes; vault library = the THIRD require source
      (app/vault config maps namespace→folder); precedence: reject duplicate
      pack namespaces at install, vault-local overrides installed pack with a
      warning; graceful degrade "requires library `x`" when a vault-lib require
      can't resolve (mirror of unknown-component fallback); components stay
      app-level (compiled) while shared Lua may be vault-level (interpreted).
- [x] A6 (F6) §6: linking position — inter-note links are plain relative
      markdown links; `[[wiki-links]]` are an app affordance, not format; a link
      to `./x.mk.md` SHOULD resolve to `./x.mkbundle` when the bundle exists.
- [x] A7 (F9) §8: script `name` restricted to `[A-Za-z_][A-Za-z0-9_-]*` — no
      dots (reserved by dotted-path access in `data=`/`:value[]`).
- [x] A8 (F10) §8: pin the fence-meta attribute grammar normatively (first
      `{...}` group in the info string; `key`, `key=bare`, `key="quoted"`,
      `key='quoted'`; whitespace-separated; quoted values may contain braces) +
      require conformance fixtures for its edge cases.
- [x] A9 (F1/F5) §8: "rendering is pure" bullet — values are read from the
      host's value cache (app-side store or bundle `.cache/`), not only "the
      bundle".
- [x] A10 (F3) §8: new "Vault-published values" subsection (the bulletin
      board) — a script fence with the bare `publish` attribute publishes its
      named value to a vault-level, app-managed store after a successful run;
      consumers read with an `@` prefix (`data=@gh.stars`, `:value[@gh.stars]`);
      ONE writer per published name (app rejects collisions, same rule as pack
      namespaces); reads are render-time and pure; publishing requires a grant;
      the store is app-side, never files in the vault. This SUPERSEDES the
      earlier "other notes bundle.read another note's .cache" idea, which
      contradicted the §11 jail (jail is unchanged: a script only ever sees its
      own bundle).
- [x] A11 (F1/F5) §9: persistence reframe — invariants are (1) rendering never
      executes, (2) the host never writes authored files, (3) caches are
      disposable; WHERE a host persists last-run values is host policy (app-side
      store recommended, keyed by note identity); bundle `.cache/` is the
      *portable* form, not the only persistence.
- [x] A12 (F7) §10: the grant key covers the full executable closure — inline
      scripts + `src=` files + required bundle-local modules + vault-library
      modules + installed pack module versions; any change re-prompts.
- [x] A13 (F8) §10: read-only tier is NOT a no-exfiltration tier (GET query
      strings carry data out); permission prompts must say "can SEND data to
      <host>", and this is why net grants are per-host.
- [x] A14 (hygiene) §12/§13.5: §12 says markii-core holds "parse, registry,
      render" (registry/render live in @markii/react — correct it); §13.5 lists
      only two packages where six exist.
- [ ] Commit Phase A (DESIGN.md + this file).

## Phase B — feature 1: layout presets (§4) — DONE (commit 3f56c6c)

Delivered via Opus-orchestrated Sonnet workers, adversarially verified (52
probes), gates green (623 tests). Leftovers moved to Phase C pre-tasks:
inline-directive stripping of reserved layout keys, chart pixel-sizing
removal, optional playground `:::row` demo. Original scope for reference:

Implementation via Opus-orchestrated Sonnet workers. Scope:

- `width=narrow|normal|wide|full` and `align=left|center|right` as generic
  directive attributes: intercepted in @markii/react's `DirectiveElement`
  (same pattern as `data=` — see `resolveDataAttribute` in `render.tsx`),
  stripped from the attributes the component sees, applied as
  `mk-width-*`/`mk-align-*` classes on a wrapper div that sits in the `.doc`
  rhythm flow. Invalid/unknown values degrade silently to default, never throw.
  Inline (text) directives ignore layout attributes entirely.
- `:::row{cols=2|3|4}` container: @markii/stdlib contract + @markii/react
  component + `doc.css` grid (auto-fit, equal cells, stacks on narrow
  viewports). `cols` invalid/absent → auto. No other knobs.
- `doc.css`: preset classes; column width logic must not break the
  `.doc > * + *` rhythm rule.
- Conformance fixtures: one with layout attributes on directives; plus (riding
  along from Phase A) the script-name charset fixture (A7) and fence-meta
  grammar edge-case fixtures (A8). Enforce the A7 charset in @markii/core's
  `extractScripts` (an invalid name ⇒ not a script, i.e. display-only —
  degradation, never an error), with tests + fixture together.
- Adversarial verification checklist: hostile values (`width=javascript:...`,
  `cols=99`, `cols=-1`, `align` on `:kbd[...]`), attribute stripping doesn't
  eat same-named component attributes elsewhere, wrapper doesn't break
  unknown-directive fallback, rhythm intact, no outer margins introduced.
- Playground demo update showing a `:::row` dashboard (optional, small).

## Phase C — bulletin board implementation (vault-published values)

Pre-tasks carried over from Phase B (small, do first):
- Strip reserved layout keys (`width`/`align`) on INLINE directives too — they
  are reserved everywhere; inline just never gets a wrapper (§4, updated).
- Remove pixel `width`/`height` from the chart stdlib contract + component
  (charts size to their container; layout presets are the sizing story).
- Optional: playground demo section showing a `:::row` dashboard.

Main scope (spec landed in Phase A, item A10):

- @markii/core: `extractScripts` exposes a `publish` boolean read from the
  fence meta (bare attribute). (Name-charset enforcement already lands in B.)
- @markii/runtime: vault-store seam — interface only (the app owns storage);
  `@`-prefixed name resolution rules; single-writer-per-name enforcement hook;
  note-scoped store stays the default for bare names.
- @markii/react: `data=@name` / `:value[@name]` resolve against the vault
  store with identical degradation (missing/stale markers, never throw).
- Prototype-safety everywhere (null-proto stores, Object.hasOwn), same as the
  existing value store.
- Publishing-requires-grant is host wiring — interface stubs only for now.

## Phase D — linking

Spec-only for now (done in Phase A, item A6). App-side resolution rule
(`./x.mk.md` → `./x.mkbundle`) belongs to hosts; nothing to build here yet.

## Phase E — security hardening (non-blocking; deliberately LAST per user)

- Grant-closure hashing: implement the A12 rule as real host infrastructure
  (needs the permission-UX / run-trigger work that is already a known gap).
- Permission prompt wording ("can send data to X") — part of the same
  permission UX.
- `messageForFailure` rework: distinguish lua-bug vs capability-denied vs
  tier-blocked declaratively (known follow-up from the run-path slice).
- Full adversarial re-audit of @markii/lua sandbox internals (globals, limits,
  marshal, the xpcall fix) — offered to user; run if ordered.

## Parked / awaiting user

- README.md has an **uncommitted** `# Mark` → `# Mark II` title edit. Asked
  twice, no answer yet. Do NOT commit README.md until the user decides
  (memory records a "Mark II" rebrand as previously rejected).
- NPM_TOKEN repo secret — required before any future npm version publishes.
- Second non-React renderer (§13 toolkit-neutrality proof).
- Phase-3 "registry growth": user's personal component library location still
  not provided.
