# Mark — Design Spec

A plain-text note format that renders your personal library of React components inline
with ordinary markdown, without turning your notes into code.

## 0. What this is — and is not

One product, three layers, each fully useful without the one above it:

1. **A document format** — markdown + directives rendering your React components.
   This is the product; everything else is optional on top of it.
2. **Live documents** — script blocks feed values into those components
   (fetch → chart). A "Streamlit inverted": Streamlit is code that emits widgets;
   this is a document that embeds widgets, optionally fed by code. The personas
   differ: *note-writers* (possibly non-technical) type markdown and use
   components; *pack authors* (technical) build the components and scripts that
   make that possible. Non-technical users benefit from scripting by *consuming*
   shared packs and templates, not by writing scripts.
3. ~~A programming language~~ — explicitly out of scope, forever. The directive
   syntax stays non-Turing-complete (no conditionals, no loops, no expressions in
   attributes), and script blocks use an existing language (§8). Designing a
   language is a separate multi-year project that would eat this one.

Scope test for any future feature: does it make a *document* better, or does it
make this a worse IDE? Ship only the former.

## 1. The core decision: don't invent a language, extend one

You do **not** need a compiler, and you should **not** use a regex "pattern detector."
Regex detection breaks the moment a component tag appears inside a code fence, a
blockquote, or another component. What you need is a real markdown parser with one
extra grammar rule — and that already exists.

**Recommendation: CommonMark + the generic *directive* syntax**, parsed by
`remark` (`unified` ecosystem) with `remark-directive`.

Directives are a proposed CommonMark extension with exactly three forms:

```
Inline:      :kbd[Ctrl+S]              or  :badge[beta]{color=purple}

Leaf block:  ::timeline{src="repo.json" collapsed}

Container:   :::callout{type=warning title="Careful"}
             Any **markdown** here, including nested directives.
             :::
```

That's the entire syntax. One rule to learn (`:name[label]{attrs}`, more colons =
bigger scope), and it covers every component you will ever add, because the *name* is
open-ended — the syntax never grows, only your component registry does.

### Why not the alternatives

| Option | Verdict |
|---|---|
| Raw HTML in markdown | Renders dead, static elements — you get `<div>`s, not *your* React components with state and behavior. Also verbose and ugly in a note file. |
| MDX (`import X` + `<Timeline prop={...}/>`) | Real answer for docs sites, wrong for notes. Notes become source code: a typo crashes the whole file, imports clutter the top, and it needs a JS build step to view anything. |
| Custom compiler / own grammar | Months of work to rebuild what remark already does (nesting, escaping, code fences, incremental parsing), for zero expressive gain. |
| Regex pattern detector | Fails on nesting and code fences; every "quick fix" grows it toward a bad parser. |

So: yes, you were half reinventing a wheel — but the specific wheel you want
(*tolerant markdown + your own live components*) is directives, which is niche enough
that reaching for it is reasonable, not corny.

## 2. Architecture: two cleanly separated layers

You suspected you were mixing "where it compiles" and "where it renders." You were.
Split them like this and the whole design falls out:

```
 note.mk.md ──▶ [ PARSE ]  ──▶ AST ──▶ [ RENDER ] ──▶ React tree
              remark +               registry lookup:
              remark-directive       name → Component
```

**Layer 1 — Parse (component-agnostic).** Text in, AST out. The parser does not know
any component exists. A directive becomes a generic AST node:
`{ type: 'containerDirective', name: 'callout', attributes: {...}, children: [...] }`.
This layer is stable forever; you never touch it when adding components.

**Layer 2 — Render (registry-driven).** A plain map from directive name to React
component. Attributes become props, inner markdown becomes `children` (already
rendered). Adding component #101 is one line in the registry, zero changes to syntax
or parser.

```tsx
const registry: Registry = {
  callout:  { component: Callout,  props: CalloutProps },   // props = attribute schema (the neutral contract, see §13.3)
  timeline: { component: Timeline, props: TimelineProps },
  kbd:      { component: Kbd, inline: true },
};
```

**Unknown names never crash.** If a note uses `:::foo` and `foo` isn't registered,
render a neutral fallback (dashed box: "unknown component `foo`" + its inner content
as plain markdown). This is what makes the format tolerant like markdown instead of
brittle like code, and it's what lets you share notes with people who have fewer
components installed than you.

Concrete stack: `react-markdown` (or `remark` + `remark-rehype` +
`hast-util-to-jsx-runtime`) with `remark-directive` and one small custom plugin that
tags directive nodes for the component mapping — via the standard unified idiom of
setting `data.hName`/`hProperties` on the mdast node (not a separate hast-producing
transform). ~100 lines of glue total.

## 3. Scale and readability (your two worries)

**100+ / unbounded components?** Yes, trivially — the registry is a dictionary, and
directive names are unbounded. There is no per-component syntax cost.

**Will it get cryptic?** Only if the *names* do; the syntax itself never grows. Guardrails:

- Names are words you choose: `:::recipe`, `:::mood`, `::divider`, `:cite[...]`.
  Enforce lowercase-kebab, allow aliases (`:::warn` → `callout{type=warning}`).
- Namespacing only when you import someone else's pack: `:::ana/timeline`. Your own
  components stay unprefixed.
- **Graceful degradation is the real readability guarantee**: in GitHub or any plain
  markdown viewer, a container directive shows as three odd `:::` lines around
  perfectly readable markdown. The note survives outside your tool. Design rule to
  preserve this: *meaningful content goes in the directive body (markdown), only
  configuration goes in `{attrs}`*. A note where the prose lives in attribute strings
  is a note you've lost. The same test flags the format's worst-degrading
  construct: inline `:value[...]` interpolation (§8) shows up as literal
  directive syntax *mid-sentence* in a plain viewer, unlike `:::` fences,
  which at least sit on their own lines around readable prose. It stays in
  the format — live values in prose are worth having — but prose meant to
  travel should prefer component bindings (`::stat{data=...}`), which degrade
  to a clean line of their own.

## 4. Layout: alignment, margins, position (your biggest concern)

Rule that makes this tractable: **components own their insides; the document owns the
outsides.**

- Components must not ship outer margins. The document stylesheet owns vertical
  rhythm — one rule like `.doc > * + * { margin-block-start: 1rem }` spaces *every*
  block element (paragraphs and components alike) identically. New components
  automatically sit correctly in the flow; no per-component tuning, ever.
- **Block components** are normal flow elements: full column width, `max-width: 100%`,
  never floated, never absolutely positioned. They behave exactly like a paragraph
  that happens to be interactive.
- **Inline components** (`:kbd[...]`) are `inline-block`, `vertical-align: baseline`,
  height capped near `1.4em` so they don't disturb line height.
- Authors get a *small closed set* of layout attributes — not freeform CSS:

  ```
  :::chart{width=wide}      → narrow | normal (default) | wide | full
  ::img-pair{align=center}  → left | center | right (block-level alignment only)
  :::row{cols=3} … :::      → cols: 2 | 3 | 4 (default: auto-fit)
  ```

  Each maps to a predefined class in the document theme. No `style=`, no arbitrary
  values. Freeform layout in notes is how documents rot; presets are how they stay
  consistent as your component set and theme evolve.

  `width` and `align` are **reserved attribute names**: the renderer
  intercepts them on every directive — valid value or not, block or inline —
  and a component never sees them among its attributes (a component wanting
  its own size knob must name it something else; pixel sizing contradicts the
  closed-preset rule anyway). On inline directives they are stripped and
  otherwise ignored — no wrapper, no effect. `align` takes visible effect
  only together with a `width` preset that makes the block narrower than the
  column; a full-width block has nothing to align.
- **`:::row` is the one layout *container*.** Its block children become
  equal-width cells that wrap responsively and stack on narrow viewports —
  and, in a plain markdown viewer, simply stack (the fence lines show, the
  content stays readable). No spans, no per-cell sizing, no other knobs: it
  exists so a dashboard of `::stat`s and `::chart`s can sit side by side, and
  nothing more. An invalid or absent `cols` degrades to auto-fit, never an
  error.
- Text wrapping around components (floats): don't. It's the single largest source of
  layout pain and reads badly at every width. Everything stacks — side-by-side
  placement is what `:::row` is for; floats stay banned.

## 5. Extensibility & sharing (nice-to-have, phase 3)

A shareable **component pack** is an npm-ish folder:

```
pack.json      { name: "ana", components: { timeline: "./Timeline.tsx", ... } }
Timeline.tsx   the component (props typed; schema derivable from types or zod)
```

Installing a pack merges its components into the registry under its namespace.
A note never references a pack by filesystem path — packs are app-installed,
and a note reaches them by namespace alone.
An author references a pack component by an explicit **prefixed name they type
themselves** — `:::ana-timeline` — never an auto-registered bare name. A
directive name may not contain `:` (it is reserved syntax), so the namespace
prefix uses `-` or `_`. Nothing is imported implicitly: like a language import,
the author opts in by typing the prefixed name. On a literal name collision the
registry resolves last-wins by merge order, but prefixes make collisions a
non-issue by convention. Shared *code* travels the same way — a pack is the
distribution unit for reusable Lua modules too (`require "ana/http"`), so a long
script is maintained once, not copied per note.
Notes optionally declare intent in frontmatter — purely informative, drives the
fallback message ("this note uses pack `ana`, not installed"):

```yaml
---
uses: [ana]
---
```

No import statements in the note body — the note stays prose.

### Vaults and the vault library

A **vault** (workspace) is just a directory of notes — `.mk.md` files and
`.mkbundle` bundles side by side — plus, optionally, one shared Lua library.
Nothing else lives there: component packs are installed in the *app* (they are
compiled code that must build into the host, §13.6), and a note references
everything shared by name, never by path.

The **vault library** is the third `require` source (§8's other two are
bundle-local `scripts/` and installed packs): a folder of plain `.lua` files
inside the vault (say `my-vault/mylib/`) that the app maps to a namespace via
app/vault configuration (`mylib → mylib/`). Notes write `require "mylib/etl"`
— never a relative path, never `..` — and the sandbox resolves it through the
app's mapping. Lua may live vault-side because it is interpreted source the
sandbox runs from text; components may not, because they are compiled code
executing in the app's own realm.

Collision rules are flat and boring on purpose (no transitive resolution, no
version ranges): installing two packs with the same namespace is rejected at
install time; a vault-library namespace that shadows an installed pack
resolves to the vault library, with a visible warning. A `require` whose
namespace has no mapping in this vault fails soft, exactly like an unknown
component: the consuming script reports "requires library `mylib`" instead of
a raw error — and code meant to travel beyond one vault belongs in a pack.

## 6. File format

- Extension: `.mk.md`. Content: CommonMark + GFM (tables, task lists,
  strikethrough, autolinks) + directives, UTF-8, no binary,
  no required header. Any `.mk.md` file is openable by any markdown tool today.
- Raw HTML is **not rendered** (the reference renderer runs `remark-rehype`
  without `allowDangerousHtml`/`rehype-raw`, so `html` nodes are dropped, not
  parsed). This is deliberate: directives are the extension mechanism instead
  of embedded HTML (§1), and dropping HTML removes an injection surface (§10).
  Layout/alignment is a directive concern (§4), never a raw `<div>`.
- Frontmatter (YAML) optional, for `uses:` and note metadata.
- Inter-note links are ordinary relative markdown links
  (`[roadmap](./roadmap.mk.md)`) — pure CommonMark, working in every viewer
  today. `[[wiki-link]]` syntax is an app affordance, not part of the format.
  So that promoting a note to a bundle (§9) doesn't break links pointing at
  it, a link to `./x.mk.md` SHOULD resolve to `./x.mkbundle` when a bundle of
  that name exists. Anything richer — backlinks, stable note identity — is
  app territory, deliberately unspecified here.

## 7. Build order

1. **Core** — Vite + React app: file open → remark + remark-directive → registry of
   ~3 components (`callout`, `kbd`, one fun one) → rendered view with the fallback box.
   This proves the whole architecture in a weekend.
2. **Live authoring** — editor pane + preview (CodeMirror 6), debounced re-parse.
   Later: incremental block-level re-parse if files get huge.
3. **Registry growth** — port your existing component library in; add the layout
   attribute presets and document theme.
4. **Packs** — pack format, namespaces, `uses:` frontmatter.
5. **(Maybe never)** — a language server / editor plugin for autocomplete of
   directive names. Only worth it past ~50 components.

## 8. Scripting

Prior art: SilverBullet (embedded Lua), Org-mode Babel, Observable/Jupyter notebooks.

**Model: scripts are data providers, not document mutators.** A script block runs,
returns a value; the value gets a name; directives consume it. The document stays
declarative — prose and components — and scripts feed them.

````
```lua {name=stars}
local repo = net.fetch_json("https://api.github.com/repos/x/y")
return repo.stargazers_count
```

::stat{data=stars label="GitHub stars"}
````

Rules that keep this a *note* and not a program:

- Script blocks are ordinary fenced code blocks with a `{name=...}` attribute —
  plain markdown viewers just show the code. No new syntax.
- Scripts **return values**; they never write into the document body. No
  self-modifying notes.
- **Rendering is pure; running is an event.** Opening/rendering a note only reads
  last-known values from the host's value cache (§9 — the app's own store, or
  a bundle's `.cache/`) — it never executes a script — so a
  note renders instantly and offline with last-known, stale-marked data, and
  re-opening costs zero network calls. Execution has three triggers, and the
  trigger caps what the script may do (the browser "user activation" rule —
  effects always cost a click):

  | Trigger | Allowed capabilities |
  |---|---|
  | Manual run (run / run-all button) | all manifest grants, incl. effectful ops (POST/PATCH, bundle writes) |
  | Auto-run on open (opt-in grant) | read-only tier: GET, bundle/cache reads, cache writes |
  | Scheduled/periodic (opt-in grant) | read-only tier |

  The read-only tier is enforceable, not honor-system: Lua has no ambient
  network — the host implements `net.fetch_json`, and the read-only variant
  exposes no method/body at all. An effectful call under an auto trigger fails
  cleanly; the consuming component shows a "requires manual run" marker.
  `cache.get(key, ttl, fn)` makes TTL the rate limiter even for manual runs, and
  schedules live in the app, never inside Lua (no timers in the sandbox).
- Values reach prose by **render-time interpolation**, never by rewriting the
  file: `:value[stars]` renders a named value inline; `{data=stars}` feeds it to
  a component. Both accept a **dotted path** — `:value[repo.stars]`,
  `{data=repo.spark}` — to reach a field of an object/array a script returned
  (own-property access only, so it can't traverse into the prototype chain). The `.mk.md` source stays clean — values overlay the document.
- Directives reference values by name (`data=stars`). If the value is missing or the
  script hasn't run, the component renders its empty/stale state — same graceful
  degradation as unknown directives.

**"Does this cross into Excel territory?"** Yes, deliberately — this is the notebook
computing model, and fetch-data-into-a-chart is its best use case. The line to hold:
Excel is *keystroke-reactive* (every edit recomputes everything, the grid is the
program). Here, recomputation is explicit or on-open, dependencies are a shallow
name→consumer map, and the document remains readable with all scripts stripped.
If you can't delete every script block and still have a coherent note, it's become a
program wearing a note costume.

### Language choice: Lua, sandboxed — with the runtime kept pluggable

The security model (§10) is language-agnostic: empty environment, injected
capability functions, resource limits. Candidates weighed: JavaScript (stack
coherence, but rejected on taste), Python/Pyodide (~10MB runtime, slow start),
Starlark (lovely semantics, DIY embedding), Wren/Rhai (elegant but niche,
ecosystem risk). **Decision: Lua** — chosen deliberately, not because SilverBullet
uses it (it's also Neovim's, Redis's, and half the game industry's embedding
language, for the same reasons that apply here):

- **Best embedding story in existence**: ~200KB, WASM builds (wasmoon), a fresh
  isolated environment per note is microseconds, instruction-count hooks give
  cheap timeouts.
- **Plain, readable syntax** — not flashy, but the closest thing to "executable
  pseudocode" after Python, which is what less-technical authors parse best.
- **Decent AI/doc coverage** thanks to decades of game modding — good enough for
  the copy-paste-and-adapt authoring loop.

What actually makes scripting friendly is not the language but the **host API
surface**: small, flat, well-named — `net.fetch_json(url)`, `cache.get(key, ttl,
fn)`, `bundle.read(path)` — a dozen functions someone can hold in their head,
documented with one example each.

Script blocks are tagged with their language (` ```lua {name=...}` `), so the
runtime is pluggable by design: other languages can be added later as optional
runtimes without touching the format.

### Script placement, long scripts, and modules

- **Short scripts** are inline fenced blocks — deliberately ordinary code blocks,
  so every non-scripting viewer degrades to readable highlighted code.
- **Only a fenced block carrying `{name=…}` (or `{src=…}`) is runnable.** A bare
  ` ```lua ` block with no such attribute is display-only and never executes, so
  example code can sit in a note harmlessly. The attribute is the sole
  runnable-vs-display switch; no bespoke non-code syntax is introduced, precisely
  so the block still degrades to highlighted code everywhere else. A script
  `name` must match `[A-Za-z_][A-Za-z0-9_-]*` — dots in particular are
  reserved, because `data=`/`:value[]` read a dot as path traversal
  (`repo.stars`), which would make a dotted *name* unreachable. The meta
  grammar itself is normative and deliberately mirrors directive-attribute
  syntax: the first `{...}` group in the fence's info string holds
  whitespace-separated `key`, `key=bare`, `key="quoted"`, or `key='quoted'`
  attributes, where quoted values may contain braces; implementations must
  match the conformance fixtures covering its edge cases. Boolean fence-meta
  attributes (`publish`, the reference renderer's `open`) are **bare-only**:
  writing any value — `publish=true` no less than `publish=false` — is not
  the boolean form and counts as absent. Fail closed: an unrecognized
  spelling must never enable behavior.
- **Script presentation is the renderer's choice, not the format's.** The
  reference renderer folds a runnable block to a collapsed one-line marker
  (`⚙ name · lua`) by default, expandable on demand; a renderer may instead show
  it in full or hide it entirely in a reading view. The format's only rule is
  that the code stays in the file — a plain markdown viewer always shows it — so
  hiding it in a polished view never costs portability or provenance.
- **Long scripts** never bloat the note: the block becomes a one-line reference,
  ` ```lua {src=scripts/etl.lua name=stars}` ` with an empty body, and the code
  lives in the bundle's `scripts/`. The note keeps a visible marker; prose stays
  prose.
- **Shared code** enters through a *sandboxed* `require` with exactly two
  sources: bundle-local modules (`require "scripts/util"`, same path-jail as
  `bundle.read`) and pack-shipped Lua modules (`require "ana/http"`, namespaced
  like the pack's components). Pure Lua only. **The two are disambiguated by
  reserved names:** the bundle's structural directories — `scripts`, `assets`,
  `.cache` — always resolve inside the bundle and can never be a pack namespace,
  so a name beginning with one of them (`require "scripts/…"`) is unambiguously
  bundle-local and every other first segment is a pack namespace. The same
  reservation applies to component names, so `:::scripts-x` can never shadow a
  bundle path.
- **Explicit non-goal: no package manager.** No luarocks, no network `require`,
  no dependency resolution — network require is code injection into a "note",
  C modules can't run in the WASM sandbox anyway, and packs already are the
  distribution unit for shared code.
- Script blocks may appear anywhere markdown may (including inside containers),
  but `name`s land in one note-scoped value store regardless of position.
- **The runtime is app-owned.** wasmoon (Lua 5.4) ships inside the host app,
  version-pinned, updated with the app — never installed by users, never carried
  in notes or bundles (§13.6 durability rule). The available stdlib is a curated
  slice (`string`, `table`, `math`; no `os`/`io`/raw `require`) plus the host
  capability API; `manifest.json`'s spec version tells future runtimes which
  semantics to honor.

### Vault-published values (the bulletin board)

A named value is note-scoped by default. Cross-note data sharing — the
monitoring-dashboard case, where one note's ETL feeds many notes' components —
goes through exactly one mechanism: a note can *publish* a value to a
vault-level, app-managed store, and any note in the vault can read it.

````
```lua {name=gh publish}
return cache.get("gh", 3600, function()
  return net.fetch_json("https://api.github.com/repos/x/y")
end)
```

::stat{data=@gh.stargazers_count label="Stars"}   ← any other note in the vault
````

- **Publishing is declarative**: the bare `publish` attribute on the script
  fence, no API to call. After a successful run, the host copies the script's
  returned value into the vault store under the script's name.
- **Readers use an `@` prefix**: `{data=@gh.stargazers_count}` and
  `:value[@gh.stars]` read the vault store; bare names stay note-local. The
  whole mental model is one sentence: *bare name = mine, `@name` = the
  vault's.*
- **One writer per name.** The app rejects a second note publishing an
  already-claimed name — the same flat-collision rule as pack namespaces
  (§5). Readers are read-only; there is no shared mutable state, only
  single-writer snapshots carrying the usual freshness status
  (fresh/stale/missing), with the usual graceful degradation when absent.
- **Reading is render-time and pure** — displaying `@gh.stars` executes
  nothing and needs no grant. *Publishing* requires a grant ("this note wants
  to publish `gh` to your vault"), because it writes beyond the note.
- **The store is app-side** (§9): publishing adds no files to the vault.
- This supersedes any sharing scheme based on reading another note's bundle.
  The §11 jail is unchanged — a script only ever sees its *own* bundle.
  Share *code* through packs and the vault library; share *data* by
  publishing.

## 9. Bundle format: `.mk.md` file vs `.mk.md` bundle

The long-scripts and images problems are the same problem, and it has a proven
answer: **TextBundle** (also `.epub`, `.docx` — all "zip of a folder with a
manifest"). Adopt the same dual-form approach:

```
note.mk.md            plain single file — remains first-class, never deprecated
note.mkbundle/          bundle: a plain directory…
  manifest.json     format version, permissions (§10), script/value declarations
  note.mk.md          the document (unchanged syntax; relative refs into the bundle)
  assets/           images, attachments
  scripts/          script files too long to inline: ``lua {src=scripts/etl.lua name=x}``
  .cache/           script outputs & fetched data — regenerable, gitignored
note.mkbundle (file)    …or the same directory zipped, for sharing/export
```

- **Directory form is the working form**: git-diffable, editable with any tool,
  greppable. **Zip form is the interchange form**: one artifact to send someone.
  The app treats them identically (open folder or open zip).
- The document never grows blobs: images and long scripts live beside it *inside*
  the bundle, so links are relative and can't dangle — moving the bundle moves
  everything. This is what "linking files next to the note" was missing: the bundle
  boundary makes the note + its dependencies one object.
- `.cache/` is explicitly disposable. Deleting it must never lose authored content.
  It is dot-prefixed so editors and file explorers hide it by default — it is the
  host's to write, never the author's to edit.
- **Persistence is governed by three invariants, not by file form**: (1)
  rendering never executes (§8); (2) the host never writes authored files — a
  note is edited only by its author; (3) caches are disposable — deleting one
  loses no authored content. Within those, *where* a host keeps last-run
  values is host policy: an app SHOULD persist them in its own storage (keyed
  by note identity) so that a plain `.mk.md` reopens with last-known values
  while the vault directory stays byte-identical; the minimum a host may do is
  an in-memory store for the session. Bundle `.cache/` is the *portable* form
  of the same cache — the data travels inside the bundle when it is zipped and
  shared — not the only sanctioned persistence. Promoting a file to a bundle
  is therefore about portability (assets, long scripts, data that must travel
  with the note), a host choice, never a toll for memory. Rendering a bare
  file stays pure either way: bound values show their empty state until some
  run — this session's or a persisted earlier one — fills them.

## 10. Security model

**A blanket "trust this note? [OK]" dialog is the Word-macro model, and it failed** —
users click OK, that's the whole history of macro malware. Best practice is the
inverse: **sandbox by default, capability-based permissions, prompts only for
specific grants.**

- Scripts run in an **empty Lua environment**: no `os`, no `io`, no `require`,
  no globals except the capability functions the host injects. A fresh
  environment per note costs microseconds and kilobytes, so sandbox-per-note is
  *not* overengineering. (Overengineering would be an OS process per note for a
  personal tool; Lua-in-WASM inside a Web Worker is the cheap middle ground —
  never run note scripts in the host page's JS realm.)
- Capabilities are **declared in the manifest, granted by the user, injected as
  functions**:

  ```json
  "permissions": {
    "net":    ["api.github.com"],
    "bundle": ["read", "write:.cache/"]
  }
  ```

  The prompt becomes meaningful: *"this note wants network access to
  api.github.com"* — a decision a human can actually make, unlike "trust this note."
  Grants are remembered per note, keyed by a hash of the note's full
  *executable closure* — its inline scripts, `src=` script files, required
  bundle-local modules, vault-library modules, and the versions of any pack
  modules it requires. If any of that code changes, the grant is stale and
  the host re-prompts; otherwise edited shared code would silently inherit
  grants that were made to different code.
- **The read-only tier is not a no-exfiltration tier.** A GET request carries
  data outward through its URL — query strings, path segments — so a note
  holding a `net` grant plus bundle reads can ship bundle contents to a
  granted host with no click at all under an auto-run trigger. The per-host
  allowlist is the real boundary; that is why `net` grants are per-host, and
  why the permission prompt must be worded as what it is — *"this note can
  **send data to** api.github.com"* — never the softer "wants network
  access".
- Resource limits: instruction-count hook (kills infinite loops), wall-clock timeout,
  memory cap, fetch response size cap.
- **In-process limits are best-effort; the terminatable isolate is the real guarantee.**
  The instruction hook stops a runaway loop by raising a Lua error, but a WASM/Asyncify
  interpreter cannot always be interrupted mid-instruction from inside its own realm:
  an adversarial script can reach a state where the hook can no longer unwind the VM,
  synchronously blocking the thread it runs on so no in-realm guard (JS flag,
  `Promise.race` timeout) can fire. Therefore the runtime contract is normative:
  **a host MUST run note scripts in a dedicated, terminatable isolate (Web Worker /
  `worker_thread`) with an EXTERNAL wall-clock watchdog that calls `terminate()` when a
  run overruns.** The isolate is not just for realm separation (§10, "never run note
  scripts in the host page's JS realm") — it is the only reliable kill switch. The
  reference `@markii/lua` sandbox closes every known in-VM interrupt-evasion vector it can,
  but does not — and structurally cannot — promise to stop every possible hang without
  this external terminate.
- **Auto/scheduled runs are gated on the terminatable isolate.** Because they carry no
  per-run user gesture (§8's trigger×capability model), an auto-run note that hangs would
  freeze the host on open with nothing to blame. Auto/scheduled execution is only sound
  atop the external-`terminate()` watchdog above; manual runs share the same requirement
  but at least fail behind a deliberate click.
- Untrusted notes (opened from elsewhere) start with **zero grants** and still
  render fully — because scripts only feed values, the document degrades to
  stale/empty component states, never to a broken page. Reading a note must always
  be safe; only *running* it needs trust.

## 11. Bundle-scoped filesystem (the ETL use case)

Your instinct is right and it's the standard shape (it's exactly a mobile app's
app-scoped sandbox): **the bundle is the script's entire filesystem.**

- API is `bundle.read(path)` / `bundle.write(path, data)` — no absolute paths, no
  `..`, no symlink following; the host resolves everything inside the bundle root
  and rejects escapes.
- Within the bundle, write access is **`.cache/` only by default**. Scripts can never
  write `note.mk.md` (no self-modifying documents) and never `manifest.json` — that
  one is load-bearing: a script that can edit the manifest can grant itself
  permissions. Reads are bundle-wide (assets, cache, own scripts).
- The ETL pattern falls out naturally: fetch via granted `net` capability → write
  normalized data to `.cache/repo-stats.json` → later runs (or offline opens) read
  the cache; components render last-known data with a staleness indicator. Add a
  `cache.get(key, ttl, fn)` helper so "fetch unless fresh" is one line.

## 12. Repository & implementation shape

**Library-first.** The format is the product; apps are consumers. The reference
implementation is a TypeScript library split along the format's own seams
(`@markii/core` parse/AST + corpus runner; `@markii/stdlib` component
contracts; `@markii/react` registry + renderer; `@markii/runtime` value store
+ run orchestration; `@markii/lua` sandbox; `@markii/bundle` container), its
conformance fixtures (`.mk.md` inputs + expected outputs — for a file
format, the test suite is half the definition), and a thin Vite playground
(`apps/playground`) that exists only so humans can see components render during
development. Any future note-taking app, editor plugin, or third-party tool
imports `@markii/core`; nothing in the core may depend on the playground.

Stack: TypeScript (strict) + React 18 + Vite + Vitest; parsing via `unified` /
`remark-parse` / `remark-directive` / `remark-rehype` / `hast-util-to-jsx-runtime`;
CodeMirror 6 and wasmoon enter in later phases. npm workspaces.

## 13. Standardization: how third parties implement their own renderer

The standard is **the spec plus a language-agnostic conformance corpus** — not our
TypeScript. (This is the CommonMark model: the spec ships with embedded examples
any implementation must reproduce.)

1. **We inherit, not invent, the hard parts.** Syntax = CommonMark + the generic
   directive proposal, plus GFM (tables/task-lists/strikethrough/autolinks);
   AST node shapes = `mdast-util-directive`
   (textDirective / leafDirective / containerDirective with `name`, `attributes`,
   `children`). Parsers for this already exist in several ecosystems; a third
   party may use ours, theirs, or write one.
2. **The conformance corpus is the heart**: `conformance/` holds `*.mk.md` inputs
   with expected ASTs as plain JSON plus behavioral assertions ("must not parse
   directives inside code fences", "must not throw on unclosed containers").
   Pure data — a Rust, Swift, or Python implementation tests against the same
   files. Passing the corpus at a level (below) is what "supports .mk.md" means.
3. **Standardize renderer *behavior*, not UI.** The spec never mentions React in
   normative text. A conforming renderer MUST: resolve directive names through a
   registry, pass attributes as string key/values, render directive children as
   markdown, render unregistered names as a visible fallback without failing the
   document, and be side-effect-free on open (reading never executes scripts).
   That's the whole contract — a terminal viewer, a Vue app, or a static HTML
   exporter can all conform.
4. **Conformance levels**, so a minimal viewer is cheap to build:
   L0 parse · L1 render behavior · L2 bundles (.mkbundle) · L3 scripting + capability
   security. A read-only viewer can ship at L1 and honestly say so.
5. **Packaging follows the standard**: `@markii/core` (parse + AST types + corpus
   runner, **zero React dependency**) and `@markii/react` (our registry + React
   renderer — the reference L1 implementation, deliberately just one consumer of
   `@markii/core` among possible many). The remaining packages track the
   conformance levels themselves: `@markii/stdlib` (the L1 component
   contracts), `@markii/bundle` (L2), and `@markii/runtime` + `@markii/lua`
   (L3). Spec versions are semver; bundles record the
   spec version in `manifest.json`.
6. **Where the framework dependency lives — and where it never does.** The
   format is framework-free, but *component implementations* are renderer-bound:
   a React pack renders only in React hosts. Therefore a pack's `pack.json`
   declares its target engine (e.g. `"engine": "react"`); a host that can't run
   a pack's engine shows the standard unknown-component fallback, so notes stay
   readable everywhere. Frameworks live in **apps**, never in notes or bundles:
   an `.mk.md` file is created empty like any text file (no init, no scaffold, no
   per-file dependency), a `.mkbundle` bundle contains only content (markdown,
   assets, scripts, cache — no runtime), and end users install an app, not npm
   packages. Only *developers embedding* .mk.md in their own software take
   `@markii/core` plus a renderer matching their framework as dependencies.

## 14. Name

The format is **Mark**. The name is a pun that fuses two ideas: *markdown*
already begins with "mark", and Iron Man's suits are versioned Mark I, Mark II,
Mark III — so the brand carries a natural, techy generational-versioning
aesthetic. Concretely:

- **File extension: `.mk.md`** — a *compound* extension. The real suffix is
  `.md`, so a Mark document opens and reads as ordinary markdown in any editor
  with zero setup; Mark-aware tools additionally recognize the `.mk` tag and do
  the rich directive/component rendering. This is the graceful-degradation ethos
  applied to the filename itself. (Rejected: `.smd` collides with Valve
  StudioModel data and Sega ROM images; `.mark` is used by reMarkable/Supernote
  tablets; every short markdown-adjacent extension — `.mdx`, `.rmd`, `.qmd`,
  `.mdc` — is already taken.)
- **Bundle extension: `.mkbundle`** — one extension for both the directory and
  the zipped form (TextBundle lineage).
- **Packages: `@markii/*`** (`@markii/core`, `@markii/react`, `@markii/stdlib`,
  `@markii/runtime`, `@markii/bundle`, `@markii/lua`). The npm scope `@markii` is used because bare
  `mark`/`@mark` are taken; the format is still spoken as "Mark".

**The name is NOT the version.** "Mark" is permanent branding and is fully
decoupled from the spec version, which is plain semver. The spec is currently
pre-1.0 (0.x, still being built out); the first stable release is 1.0.0, a later
breaking revision is 2.0.0, and so on. Do not read "Mark II" as "version 2" — the
Iron Man motif is flavor, not a version scheme. A bundle's `manifest.json`
records the plain spec version in its required `mark` field (which doubles as the
format's identifying key).
