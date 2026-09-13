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
container must not throw". The corpus is the definition; the TypeScript
libraries are the only implementation today. Passing the corpus is what
"supports Markii" means.

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
- `@markii/html`: the static string renderer. It emits an HTML document
  for a note that has stopped changing, which is what publishing, CI,
  email, and archives need. Zero React.
- `@markii/ansi`: the terminal renderer. It emits text with optional ANSI
  color for a note read in a shell. Zero React, and no dependencies beyond
  core and stdlib.
- `@markii/runtime`: the value store, run orchestration, vault store, and
  grant-key computation. Framework-free and runtime-agnostic; the script
  executor is injected.
- `@markii/bundle`: bundle reading and writing in all three storage forms,
  manifest validation, and the path jail.
- `@markii/lua`: the sandboxed Lua executor that plugs into the runtime.

Install what you import, not only what you call. A minimal React embedding
is three packages:

```
npm install @markii/core @markii/stdlib @markii/react
```

`@markii/react`'s main entry reaches `@markii/stdlib` on the render path
itself, for the width and align presets and the component contracts, so a
strict resolver such as pnpm or Yarn PnP needs it declared even though
application code only ever imports `@markii/react`. The same rule applies to
anything else you import directly: declare every package your own source
names.

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

A bundle reaches `@markii/bundle` through one of three storage forms, all
satisfying the same `BundleStorage` contract. `openZipBundle` reads the zip
form, `openDirBundle` reads a directory from the `./fs` subpath and is the
only one needing Node, and `createMemoryBundleStorage` takes a plain map of
bundle-relative paths to strings or bytes for a host that already holds the
files as values. All three route every path through the same jail, so none
of them is a place to reimplement it, and all three enforce structure only:
confining writes to `.cache/` is the script view's job, whichever storage it
wraps. The memory form sits on the main entry, so a browser build can use it.

## The terminal engine

`@markii/ansi` renders a note to text. Reach for it when the reader is
looking at a shell: a command line tool, a CI log, a pager, a file someone
will `cat`. It consumes the same sanitized tree the other engines do and
emits a plain string with `\n` line endings, so nothing about it is
specific to one terminal emulator.

Its three entry points mirror the other engines. `renderMarkToAnsi` takes
document text, `renderMarkNodeToAnsi` takes one already parsed node or a
whole parsed document, and `renderMarkInlineToAnsi` renders a lone inline
directive without the paragraph wrapper. The registry argument is optional
here, defaulting to the standard set:

```ts
import { renderMarkToAnsi } from '@markii/ansi';

const text = renderMarkToAnsi(source, undefined, store, undefined, {
  width: 100,
  color: 'truecolor',
});
```

The standard components live at the `@markii/ansi/components` subpath, as
`defaultAnsiRegistry`, on the same principle as the other engines: an
application bringing its own registry never pays for the standard set.

### Color is the caller's decision

The engine never reads the environment. It has no access to `process`, to
standard output, or to any global that would tell it whether color is
welcome, and that is deliberate: the same render has to be correct when it
is going to a terminal, to a log file, and to a test. So it treats both
`'never'` and the default `'auto'` as "emit no escapes at all", and a
caller who wants detection asks for it:

```ts
import { detectColorLevel } from '@markii/ansi';

const color = detectColorLevel(process.env, Boolean(process.stdout.isTTY));
```

`detectColorLevel` honors `NO_COLOR`, `FORCE_COLOR`, `TERM`, and
`COLORTERM`, and returns no color for a destination that is not a terminal.
Pass its answer back as the `color` option. The three explicit levels,
`'16'`, `'256'` and `'truecolor'`, always mean what they say, so a caller
that has already decided can skip detection entirely.

Colors come from a theme, and the theme is the same contract the host style
layers implement: every Tier 1 token in `doc.css` maps to one entry, given
at all three depths so the engine never has to convert at render time. The
four width tokens carry no color, because in a terminal they are column
arithmetic rather than paint. `defaultAnsiTheme` is derived from `doc.css`'s
light palette and a caller may pass another through the `theme` option. A
coverage test fails when a new Tier 1 token has no entry, exactly as it does
for the two host theme layers.

### Width

Layout is column arithmetic, so the engine needs to know how wide the page
is. The `width` option defaults to 80. A command line tool should pass the
real terminal width when it has one and fall back to 80 when it does not.

Character width is measured by hand rather than by a dependency. Combining
marks and zero width characters count as nothing, East Asian wide and
fullwidth ranges and the common emoji blocks count as two, and everything
else counts as one. Escape sequences are stripped before anything is
measured. This is an approximation of the Unicode rules, not a full width
table: a sequence joined into one glyph by zero width joiners measures as
the sum of its parts, and will therefore be a little wider than it looks.
The module says which ranges it knows, and the tests name each of them.

### What a terminal cannot do

Some of the format degrades on the way to text, and it degrades predictably.

Tabs stack instead of switching, and a collapsible section renders open with
a marker line, because there is nothing to click. An image renders as its
alt text and its source, since the pixels cannot arrive. A link carries an
OSC 8 hyperlink only when color is on and the destination passes the same
URL check every engine applies, and otherwise prints its address in
parentheses, which reads correctly whether or not the terminal understands
hyperlinks. Marking an interactive element has no counterpart at all: text
output has no control to mark, so the interactive attribute produces
nothing rather than a marker that would promise something.

Quiet markers work the way they do everywhere else, with one adjustment. A
terminal has no tooltip, so the reason a value was declined is printed as
dim text next to the component rather than hidden behind a hover, on its own
line for a block component and inline for an inline one. The wording is
shared with the static engine and lives in one module, so a failing name
reads the same in a terminal as it does on a page. The same event still
reaches `onDiagnostic`, and a host routes it to its own diagnostics surface.

Author text can never put an escape sequence into the output. Every string
that reaches the terminal has its control characters removed first, so the
only escapes present are the ones the engine generated. [security.md](security.md)
has the rule and its evidence.

## Theming a host

The reference stylesheet `doc.css` is shared by every host, and the standard
components carry no light or dark variants of their own. A host never
detects which theme is active. Instead it supplies values for a small
palette, and because the host's own theme variables already differ between
light and dark, the document follows automatically.

Where no host theme layer is present, which in practice means a document
from the static HTML renderer, `doc.css` follows the reader's operating
system dark preference on its own. Set `data-mk-theme="light"` on the `.doc`
element to hold the light palette whatever the reader prefers, or
`data-mk-theme="dark"` to hold the dark one, and the attribute wins over both
the OS preference and a host's own palette mapping.

The Tier 1 contract is nineteen custom properties declared on `.doc`:
fifteen colors, and the four widths described after them.

A host that renders into a container class of its own, rather than `.doc`,
adds a bare `data-mk-root` attribute to that container and declares the Tier
1 values on the same element. Everything past the palette treats `.doc` and
`[data-mk-root]` as equivalent: the derived Tier 2 tokens, the vertical
rhythm, the base typography, and the rules for tables, code, and task lists.
The palette's own light and dark defaults stay on `.doc` alone, because a
host that picks its own container is expected to supply its own values.
Without either marker a container still shows the document, but it loses the
derived tokens, so callouts and badges read flat in both light and dark.

The palette is those fifteen colors:

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

The remaining four tokens are sizes, not colors. They are the sizing half of
the `width=` layout presets, so a host can make a preset wider or narrower
without overriding a selector:

| Token | What it is for |
| --- | --- |
| `--mk-width-fit` | the width of `width=fit`, which shrinks a block to its content |
| `--mk-width-narrow` | the width of `width=narrow` |
| `--mk-width-wide` | the width of `width=wide`, which reaches past the text column |
| `--mk-width-full` | the width of `width=full`, the widest preset |

There is no token for `width=normal`. That preset is the document's own text
column and produces no class, so there is no rule for a token to feed.

A host theme and a pack stylesheet may redefine what a preset measures. Neither
may add a preset name. The set of presets is part of the format, so a document
that uses one renders the same everywhere, and a host that invented a sixth
would produce documents no other host could show.

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
mapping. Hiding script markers works this way in both editor hosts: the renderer
still emits every marker, and the host's rule hides `.mk-script`
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
   The Lua runtime's WebAssembly binary has to reach the isolate the same
   way, and it is the larger of the two. Ship it beside the worker or embed
   it as the worker bundle does, but decide deliberately: a host that
   embeds the worker and leaves the wasm on disk runs scripts only where
   the install channel happened to copy the extra file.
   A host that ships its own executable rather than plugging into someone
   else's application has the easiest version of this problem and should
   not invent a harder one: bundle the worker entry into the same output
   directory as the program and copy the WebAssembly binary next to it, then
   resolve both relative to the program's own location at run time. The
   reference command line tool does exactly that, and falls back to running
   the worker from source only in its own development and test runs.
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
7. **The require mappings.** Resolve pack modules, keeping the reserved
   bundle segments (`scripts`, `assets`, `.cache`) bundle-local.
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
   must act on. Both expose a command that shows the current state. The
   command line tool uses standard error, which keeps the diagnostics out of
   the rendered note even when that note is being piped into another
   program; it writes a failure line for every failed script always, and the
   full detail behind a verbose flag.
   The renderers' `onDiagnostic` callback belongs here too: a quiet marker
   in the page is half of the contract, and the reason has to reach this
   surface as well. Deduplicate before writing, because a preview re-renders
   on every keystroke.
10. **Prebuilt pack conventions, if you load packs.** A pack shipping a
    prebuilt `webview.js` may ship a `webview.css` beside it: load and
    unload that exactly like a stylesheet you compiled yourself, keyed by
    the pack's namespace, and treat its absence as normal. When a pack has
    both a prebuilt script and component sources on disk, say so on your
    diagnostics surface as an informational line; it is a supported state
    and never warrants a notification.
    A host may also ship packs of its own, loaded with no configuration.
    Register those before any pack the user configured, and when a user pack
    claims a namespace a shipped pack already holds, skip the user pack and
    say so on the diagnostics surface. That keeps the ordinary rule that two
    packs cannot share a namespace, and settles the tie by load order rather
    than by refusing both.
    A pack list names folders, never archive files. A host that offers a
    folder list validates a folder before it reports the folder added:
    discovery runs first, the notice says what was actually found, and the
    reasons for anything skipped go to the diagnostics surface. Reporting
    success for a folder holding no loadable pack sends the reader looking
    for the fault in the pack rather than in the path. A host with no folder
    list, such as an archive-only one, has nothing to do here. A `.mkp`
    archive enters a host through an install step instead, and installing is
    a consent step, because it decides what code runs in a preview: validate the
    archive, then ask in words that say the pack's code will run, then ask
    again before replacing a namespace already installed, and write nothing
    until all of those have passed. A rejected archive is reported on the
    diagnostics surface and leaves nothing behind, and a namespace one of
    your own shipped packs holds is refused as you refuse it, not accepted
    and skipped on the next load.
    A host that installs packs owns where they live: its own directory, one
    folder per namespace, never a folder the reader chose and never their
    content tree. The folder name is the namespace, since that is what the
    per-device record authorizes and what a remove control acts on, so a
    folder whose manifest declares a different namespace does not load and
    is reported instead. Which namespaces actually load is a per-device decision,
    recorded beside the other decisions that authorize execution (item 12
    below), so a pack folder that arrives another way, copied in by hand or
    carried by a sync service, does not load until that device says so.
    Installing, removing, and enabling take effect at once: reload packs and
    re-render what is open rather than asking the reader to reopen it.
    Gate on the pack's declared engine in every place a pack's components
    are offered, not only where they render. A pack built for another
    renderer is reported as skipped, with its declared engine named, so it
    never reaches a completion list or an insert picker that promises
    something the renderer would answer with the unknown-component box.
11. **Pack compilation, if you compile packs from source.** A pack ships
    component sources and no build step of its own, so a host that offers
    source packs compiles them at load time with `esbuild-wasm`, and it
    must use the in-process WebAssembly path rather than the Node one. This
    is a requirement, not a preference: the Node path spawns a child
    process, and an Electron renderer ships no `node` binary for it to
    spawn, so that path fails outright there. Feed sources to the compiler
    through a resolve and load plugin instead of letting it read the disk,
    and cache the output outside the pack's own folder so a pack's source
    directory is never written to. The runtime costs roughly fourteen
    megabytes, which is enough that a host may reasonably choose not to
    embed it. A host without it is still a working host: it loads prebuilt
    packs normally and reports a source-only pack on its diagnostics
    surface rather than presenting it as broken. The reference hosts split
    exactly here, and the split is deliberate. VS Code is the authoring
    host and compiles from source; Obsidian is the consuming host, carries
    no compiler at all, and loads the prebuilt form only. A host may also
    load no packs whatsoever, which is a third supported position rather
    than an unfinished one: every pack directive then renders as the
    unknown-component box, the note stays readable, and the host says so
    where its users will look. The reference command line tool sits here.
12. **Storage that does not travel.** Anything that authorizes execution or
    network access, meaning grants, auto-run, any scheduled interval, the
    list of packs a device loads, and any switch that decides whether
    scripts run at all, is stored per user and per device, never anywhere
    that moves with the content. VS Code's application-scoped settings and global state satisfy
    this. Obsidian has no equivalent, because plugin data lives inside the
    vault and rides Sync, so the plugin uses device-local storage instead.
    A host with no application around it writes its own file, under the
    per-user configuration directory its platform defines, with permissions
    that keep it to that user. Name that file for everything it holds
    rather than for grants alone: the same store carries each note's last
    values and its run record, and a reader who deletes it expecting to
    reset permissions should not be surprised by what else goes.
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
only, never while typing, and it stays quiet: `@markii/stdlib/editor`'s
scanner acts only on a document whose fences pair cleanly from the top of
the file, and leaves anything ambiguous alone rather than guessing.

Completion and hover are note-authoring features, so both editor hosts carry
them, the same way both carry Insert Component. A host implements them against
`@markii/stdlib/editor`'s `completionAt` and `hoverAt`, which read the line
around the cursor and return the items and the range to replace. A host
never re-derives directive parsing of its own.

`@markii/stdlib/editor` is the whole editor seam, published and installable:
the standard-set component catalog, completion, hover documentation, the
Insert Component skeleton builder, and container fence lengthening. It has
no dependencies of its own, so a host that wants the standard components in
its completion list does not pull in pack loading, a bundler, or the script
runtime to get them. A host that also loads packs composes the pack half on
top of the standard catalog, the way this repo's own hosts do.

A directive-name completion context reports two offsets, and they answer
different questions. `replaceStart` is where an accepted item's text
replaces from: on a line whose rest is empty it sits at the start of the
colon run, because accepting an item there rewrites the whole fence.
`tokenStart` is where the name itself begins, after the colon run. A widget
that filters candidates against the text between its own anchor and the
cursor, which is what CodeMirror's `CompletionResult.from` does, must filter
from `tokenStart`: filtering from `replaceStart` compares every label
against a leading `:::` and shows an empty popup. Use `replaceStart` for the
edit and `tokenStart` for the filter. A host whose widget derives one anchor
from the other, as VS Code's does, uses the pair to build its filter text
rather than rediscovering the colon run itself.

Completion does not open on a line that closes a container. A bare colon run
can be a fence someone just started typing or the closing half of a
container already open above it, and only the document can tell those apart,
so `closesOpenContainerFence` makes that call at the host's trigger
boundary. `completionAt` itself still offers the full catalog for a bare
opener. The items come from the component
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

Obsidian notes can also name a file the way Obsidian does, with `[[Page]]`,
`[[Page|Alias]]`, or an embed such as `![[image.png]]`. The parser stays
unaware of that syntax by design, so the plugin converts those into ordinary
CommonMark links and images before the text reaches it. Both of its
rendering surfaces do this, Reading view and the Markii Preview pane, so the
same note shows the same picture on either one and `:::figure` is not
required for an embedded image. A link naming nothing in the vault keeps its
original text rather than breaking the render. The general rule for any
host: if you offer more than one rendering surface for the same note,
convert your own link syntax at every one of them, not only at the first one
built.

Resolution is not authorization. Each host reads an image through its own
storage layer and never outside it, so a note cannot point the preview at a
file the host would not otherwise open. The export path below reuses the
same resolution, on purpose.

Both renderers expose this as a plain option rather than a host-specific
hook. `renderMark` and `renderMarkNode` in `@markii/react`, and
`renderMarkToHtml` and `renderMarkNodeToHtml` in `@markii/html`, take an
optional `resolveImageSrc` function. It is called for a relative `<img src>`,
whether that comes from an ordinary markdown image or from a component that
builds its own, such as the standard figure. It is never called for a source
that already carries a scheme, a protocol-relative form, a bare fragment, or
an empty value. Returning `undefined`, or throwing, leaves the source exactly
as the author wrote it, so one unresolvable image never costs a render.

The result is deliberately not held to the author-facing `isSafeUrl`
allowlist that `@markii/core` applies to a URL someone typed into a document.
A resolver's answer describes where the host's own image lives, and the
legitimate answers include forms that allowlist rejects: a `data:` URI for an
embedded bundle asset, and an application scheme such as Obsidian's vault
resource path. What the renderers do refuse is a `javascript:` or `vbscript:`
result, so a resolver cannot turn an image reference into a way to run code.
That refusal reads the value the way a browser's URL parser does, ignoring
tabs, newlines, and leading control characters, because a check that trusted
the raw text would pass a disguised scheme straight through.

`resolveHref` is the same seam for an ordinary markdown link's `href`: the
same rule about which values are offered to it, the same refusal of a
`javascript:` or `vbscript:` result, and the same fall-through when it
returns nothing or throws. No standard component builds its own link, so it
only ever sees a link the parser itself produced.

`renderMarkNode` and `renderMarkNodeToHtml` accept a whole parsed document
as well as a single node, so a host that already holds the tree `parse`
returns hands it over directly instead of looping over the top-level
children itself.

`renderMarkInline` and `renderMarkInlineToHtml` render one standalone
directive without the paragraph wrapper the ordinary render puts around it.
The rule is narrow on purpose: the source has to be exactly one paragraph
holding exactly one inline directive. Anything else, including prose beside
the directive or a second block, renders exactly as the ordinary call
would, wrapper included. A live-preview widget replacing a single line of
source is what this is for.

Both renderers also take an `onDiagnostic` callback. It is called once for
each quiet marker a render produces for a value the renderer recognized and
declined to use: a known attribute whose value is outside its closed set,
and a figure source refused as unsafe. It receives the kind, the directive,
the attribute, and the same sentence the marker's own tooltip carries, so a
host can put the finding on its diagnostics surface instead of relying on
someone hovering the marker. An unknown attribute name never triggers it,
since packs and later versions of the format use names this one does not
know, and neither does the unknown-directive box, which already explains
itself in the page. A callback that throws cannot break the render.

### Marking interactive elements

Everything the standard set renders that is a real control carries
`data-mk-interactive`: tabs' buttons, a details summary, and the collapsed
script marker's summary. `@markii/stdlib` exports the attribute name as
`INTERACTIVE_ATTRIBUTE`. An editor host that renders a note inline uses it
to tell a click meant to act from a click meant to reveal the source for
editing, without maintaining a tag and role allowlist of its own. A pack
component with its own clickable element is expected to carry the same
attribute. Nothing can enforce that on a pack, since a pack is arbitrary
code, so a host should treat an element without the attribute as text.

## Exporting a note

A host can hand the reader a file rather than a view. All three reference
hosts do. VS Code writes an HTML file at a path the user picks, Obsidian
writes one beside the note in the vault or prints it straight to PDF, and the
command line tool writes one at the path its caller names, optionally as the
terminal rendering or as a plain CommonMark downgrade instead of HTML.

The downgrade is worth naming as its own thing, because it is the one export
that is not a rendering. It rewrites the author's own source: a container
directive loses its fence lines and keeps its inner markdown, a leaf directive
goes away, a text directive becomes its own text, and script fences are
dropped. What comes out is readable markdown for a tool that knows nothing
about Markii, and it is not what any component would have shown. A host that
offers it says so.

An export is not a screenshot of the preview, but it renders the same
components. A host that already has a renderer and a loaded registry in front
of it, which both editor hosts do for their preview, renders the export
body with exactly that registry and hands the resulting markup to
`@markii/host`'s `composeNoteHtmlExport`, this repository's own shared host
layer, which is not published. A host with nothing to render
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

One note rarely stands alone. Both editor hosts can follow the links out
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
