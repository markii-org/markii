# Integrating Markii

This page is for developers who render Markii in their own application:
embedding the reference libraries, choosing an engine, theming the output
and setting the rendering options. An application that also runs scripts,
installs packs or exports notes needs [hosts.md](hosts.md) as well. Users
never read either page; they install an app.

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
  color for a note read in a shell. It is built on Ink, so it depends on
  React 19; its Markii dependencies are core, stdlib and pack.
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
here, defaulting to the standard set.

All three are asynchronous. The engine lays its output out with Ink, whose
layout module loads through a top-level await, so the first render in a
process waits for that once and every render after it is immediate:

```ts
import { renderMarkToAnsi } from '@markii/ansi';

const text = await renderMarkToAnsi(source, undefined, store, undefined, {
  width: 100,
  color: 'truecolor',
});
```

The standard components live at the `@markii/ansi/components` subpath, as
`defaultAnsiRegistry`, on the same principle as the other engines: an
application bringing its own registry never pays for the standard set. A
component here is a React component that receives the directive's
attributes, its already-built children, and the render context, and returns
Ink elements.

### A note that answers the keyboard

A string is the right output for a pipe, a log, and a fixture. It is not
the right output for someone reading a note at a prompt, where a tabbed
panel should switch and a collapsed section should open. For that,
`buildMarkElement` returns the element tree instead of rendering it, and
the host mounts it with Ink itself:

```ts
import { buildMarkElement } from '@markii/ansi';
import { render } from 'ink';

const app = render(buildMarkElement(source, undefined, { width, store }));
```

A host that does this owns three things. It supplies the width, and
re-supplies it when the terminal is resized. It supplies `onExit`, which
the viewer calls when the reader presses q, since the engine never touches
the process. And it keeps its own output off the screen while the viewer is
mounted: a diagnostic written to standard error in the middle of a frame
lands in the middle of the drawn page, so a host holds those lines and
writes them after unmounting.

The keys belong to the engine, so every host that mounts the viewer behaves
the same way. Left and right, or tab, switch tabs. Enter folds a details
block open or closed. Up and down, or j and k, move focus between the
foldable blocks in document order. Pressing q calls `onExit`.

Focus is drawn twice over, so that it survives a theme whose accent is not
perceptible: the focused block's heading is colored with the accent token
and carries a `›` glyph before it, and an unfocused heading of the same
kind is indented by the same two columns so nothing shifts sideways as
focus moves. A focused, closed details block also shows a dim `enter to
open` hint beside its summary, and `enter to close` once it is open. The
engine renders one dim status line as the last line of the tree, naming
the focused block and repeating the key legend; a host mounting the tree
gets it for free and needs no status surface of its own. A tabs block is
named by its active panel, so the line follows the reader across a switch.

A tabs or details block is focusable at the top level of the document and
inside a card, a callout or a figure, all of which draw their bodies with
the layout engine's own boxes and so can hold live children. A callout's
colored type bar is a one-column left border whose glyph the engine styles
itself. A block inside a string-drawn body, such as a table cell, renders
as the string form of itself and is not part of the focus cycle.

Interactivity is a property of the render, not of the note. The same
document rendered through the string entry points is the flat page
described below, with every tab panel stacked and every section open,
because a string has nothing to press.

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

### Box style

Frames, table grids, rules, bars, star ratings, fold and focus markers,
callout icons, and the live viewer's key legend are drawn from one glyph
table. The `box` option picks its set. `'unicode'` is the default and uses
box drawing and symbol characters. `'ascii'` draws every one of them with
7-bit characters, for a terminal or a log that cannot show the others. A
note's own text is never rewritten, so only glyphs the engine adds change.
The two sets give the same widths wherever layout depends on them, so a
note wraps identically in both. A component written for this engine takes
its glyphs from `ctx.glyphs` rather than from literals, which is how the
option reaches it.

The engine never chooses the style itself. A host decides, the same way it
decides color: the command line tool uses ascii when `TERM` is `dumb` or
the locale is not UTF-8, and its `--box` flag overrides that.

### What a terminal cannot do

Some of the format degrades on the way to text, and it degrades predictably.

In a string render, tabs stack instead of switching and a collapsible
section renders open with a marker line, because a string has nothing to
press; the live viewer described above is where those two come back. An
image renders as its alt text and its source, since the pixels cannot
arrive. A link carries an
OSC 8 hyperlink only when color is on and the destination passes the same
URL check every engine applies, and otherwise prints its address in
parentheses, which reads correctly whether or not the terminal understands
hyperlinks. Marking an interactive element has no counterpart at all: text
output has no control to mark, so the interactive attribute produces
nothing rather than a marker that would promise something.

Quiet markers work the way they do everywhere else, with one adjustment for
the reason text. A missing, stale, or failed data binding still prints its
short phrase (`stale`, `script error`, and so on) as dim text next to the
value, since a terminal has no hover to hide it behind. An out-of-enum
attribute value and a refused image source are different: their full
sentence is written for a tooltip, and a terminal has no tooltip to put it
in, so printing that sentence inline would land it back in the page. Those
two cases print a short dim label instead (`[callout: type ignored]`,
`[figure: image not shown]`), on its own line for a block component and
inline for an inline one, and the full sentence reaches a host only through
`onDiagnostic`. The wording for every case is shared with the static engine
and lives in one module, so a failing name reads the same in a terminal as
it does on a page.

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
would have to be an option that leaves the default rendering unchanged.

## Rendering only

A site or app that shows its own notes and runs no scripts needs one
renderer and nothing else. In React (18 or 19):

```tsx
import { renderMark } from '@markii/react';
import { defaultRegistry } from '@markii/react/components';
import '@markii/react/doc.css';

const view = renderMark(source, defaultRegistry);
```

Pass `renderCode` to plug in your own syntax highlighting, and
`resolveImageSrc` or `resolveHref` to map relative paths onto your site.
The next section describes both.
Outside React, `@markii/html` renders the same note to a string, and
`@markii/ansi` renders it for a terminal.

## Rendering options

Each option is a plain argument rather than a host-specific hook. The
image option works as follows. `renderMark` and `renderMarkNode` in `@markii/react`, and
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

Every engine also takes a `renderCode` callback for ordinary fenced code
blocks, which is where a host plugs in syntax highlighting. It receives the
fence's language (or `undefined` when the fence names none) and the code
text:

```ts
renderMark(text, registry, store, vault, {
  renderCode: ({ lang, code }) => highlight(lang, code),
});
```

The React engine expects an element back, the HTML engine a string, and
the terminal engine a string. Returning `undefined` renders the block as
usual. The callback is never called for script fences or inline code. A
callback that throws also renders the block as usual and reports a
`code-renderer-failed` event through `onDiagnostic`.

The HTML engine inserts the returned string as-is. It is host-trusted
output, so the host escapes the code text itself before wrapping it in
markup. The terminal engine hands the callback text that its sanitizer
has already cleaned of control characters; anything the host adds is the
host's responsibility.

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
declined to use: a known attribute whose value is outside its closed set, a
figure source refused as unsafe, and a block component written as an inline
directive (`form-mismatch`). It receives the kind, the directive, the
attribute when there is one, and the sentence that explains the marker, so a
host can put the finding on its diagnostics surface instead of relying on
someone hovering the marker. An unknown attribute name never triggers it,
since packs and later versions of the format use names this one does not
know, and neither does the unknown-directive box, which already explains
itself in the page. A callback that throws cannot break the render.

A directive can also name a component that is installed but has no view in
this renderer: a React-only pack component in the terminal, say. Every
engine takes an `unavailableComponents` option listing those, each with its
pack and the engines it does have views for. A listed directive renders the
same box with a different label (no preview, HTML, or terminal view, per
engine) and reports the `no-engine-view` kind, so a reader can tell it from
a typo. The host builds that list from its pack loading, which returns every
installed component and the ones lacking a view for the host's engine. A
renderer given no list renders every unknown directive as the ordinary
unknown-component box.

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

## Where frameworks live

The format is framework-free, but component implementations are bound to a
renderer: a React pack renders only in React hosts. A pack therefore
declares its target engine, and a host that cannot run that engine shows the
standard unknown-component fallback, keeping the note readable everywhere.
Frameworks live in applications, never in notes: a `.mk.md` file is created
empty like any text file, and a bundle contains only content. No note or
bundle ever carries a runtime.
