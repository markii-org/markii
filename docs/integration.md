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

A host preference about what the reader sees, rather than about what a
component is, belongs in the host's own theme layer, not in the renderer.
Put a class on the document root and write one rule for it beside the token
mapping. Hiding script markers works this way in both reference hosts: the
renderer still emits every marker, and the host's rule hides `.mk-script`
and nothing else, so value failure markers, run markers, and pack markers
stay where they were. A preference that reached into the renderer instead
would have to be an option defaulting to today's behavior, never a change
to what the renderer does by default.

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
   A host may also offer a single switch that turns script execution off
   for the user's own machine. Put the check in the shared body every
   trigger passes through, not in each command, so a trigger added later
   cannot miss it, and read the setting at the moment of the run rather
   than caching it when the view opened, so turning the switch on stops a
   view that is already open. The switch decides whether a run happens; it
   does not touch stored grants, and turning it back off must not widen
   anything beyond what was already granted by hand. A blocked run reports
   on both surfaces the way any other failure does: a short line for the
   run the user asked for, and the diagnostics surface for a run the host
   started on its own.
5. **Value persistence.** Keep last-run values in app storage keyed by note
   identity, so plain files reopen with data while the vault directory stays
   untouched; write a bundle's `.cache/` only for bundles.
   Apply each script's value to the page as it arrives, and never treat a
   progress message from the isolate as the run's result: only the final
   settlement is. A run cut short by the watchdog still delivers the values
   that landed before it.
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
10. **Prebuilt pack conventions, if you load packs.** A pack shipping a
    prebuilt `webview.js` may ship a `webview.css` beside it: load and
    unload that exactly like a stylesheet you compiled yourself, keyed by
    the pack's namespace, and treat its absence as normal. When a pack has
    both a prebuilt script and component sources on disk, say so on your
    diagnostics surface as an informational line; it is a supported state
    and never warrants a notification.
11. **Storage that does not travel.** Anything that authorizes execution or
    network access, meaning grants, auto-run, any scheduled interval, and
    any switch that decides whether scripts run at all, is stored per user
    and per device, never anywhere that moves with the
    content. VS Code's application-scoped settings and global state satisfy
    this. Obsidian has no equivalent, because plugin data lives inside the
    vault and rides Sync, so the plugin uses device-local storage instead.
    Getting this wrong hands whoever receives a copy of the content
    authority they never granted.

## Editor support

Editor tooling is application territory. A directive-aware language server
was considered and deliberately deferred. What the two hosts carry instead
is a small, shared authoring layer: a rendered preview, a grammar for
highlighting (VS Code), an Insert Component command, and directive
completion with hover documentation.

The same layer keeps container fences legal for the author. Nesting a
container inside a container needs the outer fence pair to carry more colons
than the inner one, so when a host inserts a container, either through Insert
Component or by accepting one from the completion popup, it lengthens the
enclosing fences in the same undoable edit. It happens in those two places
only, never while typing, and it stays quiet: `@markii/host`'s scanner acts
only on a document whose fences pair cleanly from the top of the file, and
leaves anything ambiguous alone rather than guessing.

Completion and hover are note-authoring features, so both hosts carry them,
the same way both carry Insert Component. A host implements them against
`@markii/host`'s `completionAt` and `hoverAt`, which read the line around
the cursor and return the items and the range to replace. A host never
re-derives directive parsing of its own. The items come from the component
catalog (the standard set plus installed packs), the attribute contracts in
`@markii/stdlib`, and the layout preset lists the same package exports
(`WIDTH_PRESETS`, `ALIGN_PRESETS`, `LAYOUT_ATTRIBUTES`). Those preset
exports are also the one source both renderers build their layout class
maps from.

A pack contributes its own attribute metadata to the same layer. A component
that declares an `attributes` list in its `pack.json` (see docs/packs.md) is
completed by attribute name and by enumerated value, and its hover
documentation lists those attributes, so a pack component reads the same way
a standard one does in the editor. A pack that declares nothing keeps the
earlier behavior: its name completes, and its description is all the
documentation there is.

A preview also resolves the images a note references. VS Code resolves a
relative `src` against the note's folder. Obsidian tries the same
note-relative path first, then the vault's own link resolution (the lookup a
wikilink uses, so a bare file name found anywhere in the vault works), then
the path as vault-relative. Absolute file-system paths and `obsidian://`
URLs are not resolved by either host: a note that used them would only
render on one machine.

Resolution is not authorization. Each host reads an image through its own
storage layer and never outside it, so a note cannot point the preview at a
file the host would not otherwise open. The export path below reuses the
same resolution, on purpose.

## Exporting a note

A host can hand the reader a file rather than a view. Both reference hosts do:
VS Code writes an HTML file at a path the user picks, and Obsidian writes one
beside the note in the vault, or prints it straight to PDF.

An export is not a screenshot of the preview, but it renders the same
components. A host that already has a renderer and a loaded registry in front
of it, which both reference hosts do for their preview, renders the export
body with exactly that registry and hands the resulting markup to
`@markii/host`'s `composeNoteHtmlExport`. A host with nothing to render
through falls back to `@markii/html`, the static string engine. Either way the
exported file carries the shared `doc.css` inside it and loads nothing at
runtime, so it opens in any browser, attaches to an email, or goes into an
archive unchanged. `@markii/host`'s `buildNoteExport` owns the choice between
the two paths, the file naming, and the page-level CSS, so two hosts cannot
drift on what an exported file contains or what it is called. A host that
renders through a surface it does not own, the way VS Code asks its webview,
must bound the wait and fall back to the static engine rather than leave the
command hanging.

Five things follow from how an export is rendered, and a host should say
them rather than let a reader discover them.

The last run is baked in. A host passes the same persisted value store the
preview rehydrates from, so a monitoring note exports with the figures it was
showing. Those values are not demoted to stale the way a reopened preview
demotes them: a file has no re-run to be stale against. A note that has never
been run exports with its ordinary empty states, and the host says so in its
confirmation.

Pack components render when the host has them loaded. Their markup comes from
the same merged registry the preview uses, and each loaded pack's stylesheet
is embedded in the exported file after `doc.css`, in the order the host
injects it for the preview, so a pack component looks in the file the way it
looks on screen. Where the host has no renderer to reach, the static engine
renders instead and a pack directive exports as its ordinary unknown-component
fallback: a labeled box with the author's own inner content still rendered
inside it. Neither outcome is a failure, and a host must not report either as
one. The two must be distinguishable on the host's diagnostics surface, so a
reader who expected a component and got a box can find out why; the short
notice stays the same either way.

Local images travel with the file. A host hands the exporter a reader for its
own storage, and every local image a note references is embedded as a `data:`
URI, so the exported file opens with its pictures intact anywhere. Remote
`http` and `https` sources stay live URLs, because embedding them would change
what the page fetches. Each host resolves an image with the same code its preview
uses and reads it under its own jail, so an export can never reach a
file the preview itself could not show. An image above two megabytes keeps its
original source rather than inflating the file, and so does one whose
extension the embedder does not recognize, or one that could not be read. Each
of those is named on the host's diagnostics surface, with its size where that
is the reason. None of them is a failure, and none of them belongs in the
notice.

PDF is a host capability, not a format feature. Where a host runs inside a
browser engine it can print the exported document directly, and Obsidian does
so through Electron. Where it cannot, the documented path is to export the
HTML and print it from a browser. A host that offers PDF must degrade to
writing the HTML file when printing is unavailable, and must say which of the
two happened on both of its surfaces: the short notice, and the diagnostics
surface named in the host checklist above.

### Exporting a linked set

One note rarely stands alone. Both reference hosts can follow the links out
of a note, export every note they reach, and write the whole set as one zip
archive. Obsidian writes the archive beside the root note in the vault. VS
Code asks where to save it, offering the root note's own name with a `.zip`
extension. Each note in the set is exported exactly the way that host
exports a single note, so pack components, stored values, and embedded
images behave the same in a set as they do alone.

What counts as a link is the host's decision, because only the host knows
what its own links mean. Obsidian resolves both wikilinks and markdown links
against the vault. VS Code resolves note-relative markdown links against the
folder of the note that wrote them, and refuses any target that lands
outside the note's own folder and the open workspace folders. Neither host
follows a link to something that is not a markdown note.

The walk detects cycles and stops at a depth bound and a note-count bound,
saying on the diagnostics surface which bound stopped it. A note that a link
pointed at and the host could not read is named there too, beside the note
that linked to it, so a set that came back smaller than expected is never
silent about why.

Links between exported notes are rewritten to point at the sibling files, so
the archive is navigable with no vault and no network. A link to a note
outside the exported set, or to something that is not a note, is left exactly
as written. A wikilink that does point into the set becomes a markdown link,
because Markii renders CommonMark, where a wikilink is ordinary text rather
than a link; without that conversion the exported pages could not reach each
other. The walk, the naming, the rewriting, and the archive are host-neutral
logic in `@markii/host`, so a host adopts the command by supplying two
functions: one that reads a note and one that resolves a link. Exporting a
linked set to PDF is not offered.

## Where frameworks live

The format is framework-free, but component implementations are bound to a
renderer: a React pack renders only in React hosts. A pack therefore
declares its target engine, and a host that cannot run that engine shows the
standard unknown-component fallback, keeping the note readable everywhere.
Frameworks live in applications, never in notes: a `.mk.md` file is created
empty like any text file, and a bundle contains only content. No note or
bundle ever carries a runtime.
