# Integrating Markii

This page is for developers: embedding the reference libraries in an
application, writing a renderer of your own, and what a host application is
responsible for. Users never read this; they install an app.

## The standard is the spec plus the corpus

Markii follows the CommonMark model of standardization: the definition is the
written spec together with a corpus of example documents that every
implementation must reproduce. The reference TypeScript libraries are one
implementation, not the standard itself.

The corpus lives in `conformance/` as plain data: each fixture pairs a
`.mk.md` input with its expected syntax tree as JSON, plus behavioral cases
such as "directives inside code fences must not parse" and "an unclosed
container must not throw". A Rust, Swift, or Python implementation tests
against the same files. Passing the corpus is what "supports Markii" means.

Markii inherits its hard parts rather than inventing them. The syntax is
CommonMark plus GFM plus the generic directive proposal, and the syntax-tree
node shapes come from the existing `mdast` directive utilities. Parsers for
all of this already exist in several ecosystems.

## Conformance levels

Levels keep a minimal viewer cheap to build, and honest about what it does:

| Level | Means | Package tracking it |
|---|---|---|
| L0 | parses documents to the standard tree | `@markii/core` |
| L1 | renders with registry, fallback, and purity rules | `@markii/react`, contracts in `@markii/stdlib` |
| L2 | opens `.mkz` bundles | `@markii/bundle` |
| L3 | runs scripts under the capability model | `@markii/runtime` + `@markii/lua` |

A read-only viewer can ship at L1 and say so. The normative requirements for
each level are in [spec.md](spec.md).

## What a conforming renderer must do

The renderer contract never mentions React, or any framework. A conforming
renderer resolves directive names through a registry, passes attributes as
string key-value pairs, renders directive children as markdown, shows a
visible fallback for unregistered names without failing the document, and
is side-effect-free on open: reading never executes scripts. A terminal
viewer, a Vue application, and a static HTML exporter can all conform.

## Embedding the reference libraries

Only developers embedding Markii take npm dependencies; end users install an
application. The split is:

- `@markii/core`: text to syntax tree, directive tagging, URL sanitizing,
  and the corpus runner. Zero React.
- `@markii/stdlib`: the neutral component contracts (names, kinds,
  attribute schemas) every renderer implements against. Zero dependencies.
- `@markii/react`: the reference renderer, holding the registry,
  `renderMark`, and the standard component set. One consumer of core among possible many; it lives
  under `packages/platforms/` precisely so a sibling renderer for another
  toolkit has a place to sit.
- `@markii/runtime`: the value store, run orchestration, vault store, and
  grant-key computation. Framework-free and runtime-agnostic; the script
  executor is injected.
- `@markii/bundle`: bundle reading and writing in both forms, manifest
  validation, and the path jail.
- `@markii/lua`: the sandboxed Lua executor that plugs into the runtime.

A minimal React embedding is a registry plus one call:

```tsx
import { renderMark } from '@markii/react';
import { defaultRegistry } from '@markii/react/components';

const view = renderMark(source, defaultRegistry);
```

The standard component set lives at the `@markii/react/components` subpath,
not the main entry, so an application that brings its own registry never
pulls the standard components into its bundle. Adding your own component is
one registry entry, built with `createRegistry` or merged over the default
set with `mergeRegistries`; its attributes arrive as props and its inner
markdown arrives pre-rendered as children. `renderMark` also accepts an
optional value store and vault store for documents that use scripting, and
`renderMarkNode` renders a single block from a parsed document under the
same contract, for hosts that need block-level granularity.

## Theming a host

The reference stylesheet `doc.css` is shared by every host, and the standard
components carry no light or dark variants of their own. A host never
detects which theme is active. Instead it supplies values for a small
palette, and because the host's own theme variables already differ between
light and dark, the document follows automatically.

The palette is fifteen custom properties, declared on `.doc`:

| Token | What it is for |
| --- | --- |
| `--mk-bg` | the page ground |
| `--mk-raised` | raised surfaces such as cards, which dark themes need to separate from the ground |
| `--mk-fg` | body text |
| `--mk-surface` | one step off the ground: code blocks, keycaps, script markers, details, zebra rows |
| `--mk-surface-strong` | two steps off: inline code, table headers, progress tracks |
| `--mk-border` | hairlines |
| `--mk-muted` | secondary text such as captions and labels |
| `--mk-faint` | tertiary text: missing values, empty states, unfilled stars |
| `--mk-accent` | the single interactive color: active tabs, progress bars, chart strokes |
| `--mk-on-accent` | ink that sits on a solid `--mk-accent` fill |
| `--mk-info` | the informational hue |
| `--mk-success` | the success hue |
| `--mk-warning` | the warning hue, also the rating star |
| `--mk-danger` | the danger hue |
| `--mk-limit` | the hue for a run that hit a resource limit |

Everything else is derived. Each semantic variant's fill, strong fill, and
ink are mixed from its hue against `--mk-bg` or `--mk-fg` at three fixed
ratios, so a host maps the palette and every variant becomes correct in both
directions for free. A host should not override the derived properties.

Mapping the palette is the whole job:

```css
.doc {
  --mk-bg: var(--editor-background, #fff);
  --mk-fg: var(--editor-foreground, #1a1a1a);
}
```

Keep a literal fallback in each `var()` so a theme that omits a variable
still yields a readable color.

The derivations use `color-mix`, guarded by `@supports`. Where it is
unavailable, which in practice means email clients receiving a document from
the static HTML renderer, the literal light-mode values apply instead. This
is why a host must map the palette rather than restyle individual
components: a component rule that a host overrides by selector is a rule the
derivation no longer reaches.

`doc.css` is guarded by a test that fails if any raw color literal appears
outside the palette and its fallback block, and each host has a test that
fails if its theme layer leaves a palette entry unmapped. Adding a token to
the palette therefore breaks every host until it is mapped, which is the
intended behavior.

## Host responsibilities for scripting (L3)

The libraries deliberately stop at the seam where application policy begins.
An application that enables scripting owns the following, in rough order of
importance:

1. **A terminatable isolate.** Run scripts in a Web Worker or worker thread
   with an external wall-clock watchdog that terminates it on overrun. This
   is normative, and auto-run is unsound without it; see
   [security.md](security.md). Pick the isolate your runtime actually
   supports rather than the one you would prefer: an Electron renderer has
   no worker threads, and a worker thread accepts a heap cap that a Web
   Worker does not. If you land on a Web Worker, record the missing cap
   where your users can find it. How the worker's bytes arrive is the
   host's choice: a sibling file on disk works, and so does embedding the
   worker bundle inside the host's own bundle and starting it from a blob
   URL. The reference Obsidian plugin embeds, so an install channel that
   copies only the plugin's entry file still runs scripts. The isolate
   requirement is about termination, not delivery.
2. **The grant store and prompts.** Persist grants keyed by
   `computeGrantKey`'s executable-closure hash, re-prompt when the key
   changes, and word network prompts as "can send data to `<host>`".
   Re-validate stored hosts when you read them back, so a record written by
   an older or buggy version cannot reintroduce a host your current checks
   would reject.
3. **A bounded network capability.** The `net` implementation is the real
   allowlist boundary, so it enforces it: resolve redirects yourself and
   check every hop's host before requesting it, and bound each response to
   the fetch-size cap rather than buffering a whole body. A request whose
   host is built dynamically, and so cannot be named in advance, is denied;
   a prompt offered for that case must not imply the request will be
   allowed.
4. **Trigger discipline.** Route manual, auto, and scheduled runs through
   the runtime's trigger parameter so the tier gate applies; schedules live
   in the app, never in scripts.
5. **Value persistence.** Keep last-run values in app storage keyed by note
   identity, so plain files reopen with data while the vault directory stays
   untouched; write a bundle's `.cache/` only for bundles.
6. **The vault stores.** Enforce one writer per published name, and back the
   `@`-prefixed reads with your vault store implementation.
7. **The require mappings.** Map vault-library namespaces to folders, and
   resolve pack modules, keeping the reserved bundle segments
   (`scripts`, `assets`, `.cache`) bundle-local.
8. **Bundle handling, if you run bundles.** A `.mkz` bundle is
   attacker-deliverable, so treat its every part as untrusted. Read its
   files through `@markii/bundle`'s jailed storage (never your own path
   joins), and size-check a file with `BundleStorage.size` before
   materializing it, so one oversized entry cannot exhaust the host. Expose
   the bundle to scripts only through a `ScriptView` scoped to the declared
   intersect the granted permissions, keep writes confined to `.cache/`,
   and include the content of `src=` script files in the grant-key closure
   so editing a bundled script re-prompts.
9. **A diagnostics surface.** A host that loads packs or runs scripts names
   one place where failures are readable in full, and routes every pack that
   failed to load, every deprecated configuration entry, and every failed
   run to it. The rendered note keeps only a quiet marker; the detail lives
   here. A failure recorded internally and reachable from neither is a bug.
   The VS Code extension uses an output channel named Markii; the Obsidian
   plugin uses the developer console with a notice for anything the user
   must act on. Both expose a command that shows the current state.
10. **Storage that does not travel.** Anything that authorizes execution or
    network access, meaning grants, auto-run, and any scheduled interval,
    is stored per user and per device, never anywhere that moves with the
    content. VS Code's application-scoped settings and global state satisfy
    this. Obsidian has no equivalent, because plugin data lives inside the
    vault and rides Sync, so the plugin uses device-local storage instead.
    Getting this wrong hands whoever receives a copy of the content
    authority they never granted.

## Editor support

Editor tooling is application territory. A directive-aware language server
was considered and deliberately deferred; syntax highlighting for directives
and fence-meta plus a rendered preview cover most of the value, and that is
the shape of the planned VS Code extension: a webview preview embedding the
reference renderer, plus a grammar for highlighting.

## Where frameworks live

The format is framework-free, but component implementations are bound to a
renderer: a React pack renders only in React hosts. A pack therefore
declares its target engine, and a host that cannot run that engine shows the
standard unknown-component fallback, keeping the note readable everywhere.
Frameworks live in applications, never in notes: a `.mk.md` file is created
empty like any text file, and a bundle contains only content. No note or
bundle ever carries a runtime.
