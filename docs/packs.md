# Component packs

A pack is how components and shared Lua modules travel between people. The
contract, the namespace rules, the registry merging, and the sandboxed
`require` are implemented, and both reference hosts (the VS Code extension
and the Obsidian plugin) load packs. This page describes that shipped
contract. Ready-made packs live in a separate repository,
[markii-packs](https://github.com/markii-org/markii-packs); the last
section says why they are not here.

## What a pack is

A pack is an npm-ish folder: a manifest plus component sources.

```
pack.json       { "name": "ana", "engine": "react",
                  "components": { "timeline": "./Timeline.tsx" } }
Timeline.tsx    the component, with a typed attribute schema
scripts/        optional shared Lua modules the pack ships
```

Packs are installed into the application, never into a vault or a note,
because component code is compiled into the host. Installing a pack merges
its components into the registry under its namespace.

The `engine` field names the renderer framework the pack's components are
written for. A host that cannot run that engine shows the standard
unknown-component fallback for the pack's directives, so a note using an
unavailable pack stays fully readable.

`version` is optional: a plain semver string such as `1.0.0`, three numeric
parts and nothing else. It carries no prerelease or build suffix, because
the field exists for a host to read and show a pack's version, not to drive
dependency resolution. Leaving it out is valid and warns about nothing. A
value that is present but not well-formed is a manifest error rather than a
warning, on the same reasoning as a malformed `name`: a version a host
cannot trust is worse than no version at all.

### Describing a component

A `components` entry can be the string shorthand shown above, a source
path, or an object that adds metadata:

```json
"components": {
  "timeline": {
    "source": "./Timeline.tsx",
    "description": "A dated event timeline.",
    "kind": "leaf",
    "attributes": [
      { "name": "from", "description": "First date shown.", "required": true },
      { "name": "scale", "values": ["days", "weeks"], "default": "days" }
    ]
  }
}
```

`description` is one short line a host shows wherever it lists components,
such as the insert picker. `kind` names the directive form the component
renders as: `container` for `:::ana_timeline ... :::`, `leaf` for
`::ana_timeline{}`, `inline` for `:ana_timeline[]`. A host assumes
`container` when `kind` is absent, so a leaf or inline component should
declare it. Declaring it also narrows directive completion: a component with
no `kind` is offered in all three directive forms, one with `kind` only in
the form it renders as. Both forms may mix in one manifest, and older
string-only manifests are unaffected.

`attributes` lists the attributes the component reads, so an editor can
offer them the way it already offers a standard component's. Each entry
needs a `name`, a lowercase word that may contain digits and hyphens.
Everything else is optional: `description` is the one line shown beside the
attribute in a completion row, `required` marks an attribute the component
cannot do without, `values` is the closed set of accepted values, and
`default` is what the component falls back to when the attribute is absent.
A `default` declared alongside `values` must be one of them.

Declaring attributes changes three things in a host. Typing inside the
braces of your directive offers your attribute names alongside the reserved
`width` and `align`. An attribute with `values` offers those values once the
author opens the quotes. Accepting the component from the completion popup
pre-fills its required attributes, ready for the author to fill in, exactly
as a standard component's required attributes already are. Hover
documentation lists all of it, including any default.

This is metadata for the editor, not enforcement. Nothing checks a written
directive against the list, and a component still owns how it reads its own
props. Two names are reserved and belong to the layout system rather than to
you: a block component declaring `width` or `align` has that declaration
ignored, because those come from the layout presets instead. An inline
component has no layout attributes, so it may declare either name freely.

The failure posture matches the rest of the manifest: a bad `kind`, an
empty `description`, a missing `source`, or a malformed `attributes` entry
fails validation for the whole `pack.json`, and the host reports the pack as
skipped with the reason. A malformed attribute means a name outside the
allowed charset, the same name twice, a non-boolean `required`, a `values`
list that is not a non-empty list of non-empty strings, or a `default`
outside its own `values`. An unrecognized key inside a component object or
an attribute entry is only a warning, so a field added in a future version
cannot break the pack on an older host.

## Names and namespaces

An author references a pack component by typing the prefixed name
themselves: `:::ana_timeline`. Nothing is auto-registered under a bare name;
like a language import, the author opts in by typing the prefix. Directive
names cannot contain `:` (it is reserved syntax), so the namespace separator
is `_`. Underscore is deliberate: pack and component names are
lowercase-kebab and cannot themselves contain an underscore, so the one
underscore in a composed name is always the boundary between pack and
component, and two different packs can never compose the same directive
name. Prefer a single short word for a pack name; `cat_card` reads at a
glance, `long-pack-name_some-component` is legal but noisy.

The prefix is added by the host, not written in the manifest. A manifest key
names the component *inside* its pack, and the directive an author types is
the pack name joined to that key:

```
pack "ana" + component "timeline"  ->  :::ana_timeline
```

This is the one place pack authors reliably go wrong. Naming the manifest
key `ana-timeline` inside a pack already called `ana` produces the directive
`ana_ana-timeline`, which no note types, so every use of it falls back to
the unknown-component box. Keep manifest keys bare.

Your own components stay unprefixed; prefixes exist for other people's
packs. Composed names cannot collide across packs (the underscore boundary
above makes that structural), and a duplicate produced some other way, such
as a hand-written registration script, is skipped with a diagnostics line
naming both claimants. The bundle's
reserved directory names (`scripts`, `assets`, `.cache`) can never be a pack
namespace, so pack names can never shadow bundle paths, in `require` or in
directive names.

A note can declare the packs it expects in frontmatter:

```yaml
---
uses: [ana]
---
```

This is purely informative. It lets a renderer say "this note uses pack
`ana`, which is not installed" instead of showing unexplained fallback
boxes. There are no import statements in a note body; the note stays prose.

## Packs carry code, vaults carry data

A pack is also the distribution unit for shared Lua: `require "ana/http"`
loads a module the pack ships, so a long script is maintained once rather
than copied per note. For helpers that only matter inside one vault, a
pack that declares no components fills the same role locally: just a
`scripts/` folder and `"components": {}` (see
[scripting.md](scripting.md)). The same mechanism carries those helpers
along once you decide to share them.
Sharing *data* between notes is a different mechanism entirely, the
published-value store, and never involves packs.

## Collision and install rules

Flat and boring on purpose. Installing two packs with the same namespace is
rejected at install time. There is no transitive dependency resolution and
there are no version ranges.

## Bundled packs

Three packs ship with the reference hosts and need no installation: `read`
for reading and annotation notes, `dash` for dashboards, and `prep` for
revision notes. They are ordinary packs in every way that matters. Their
components are namespaced like any other, so `read`'s `source` component is
written `read_source`. A note lists them in `uses:` the same way. They
appear in the insert catalog and in directive completion.

They are registered before any pack a user configured. A user pack that
claims a namespace a bundled pack already holds does not load, and a host
that installs packs refuses it at install time rather than accepting it and
skipping it later. Either way the host says so, and the bundled pack wins. This follows
the ordinary collision rule above rather than making an exception to it: two
packs still cannot share a namespace, and the tie is broken by load order
instead of by rejecting both.

Bundling changes nothing about how a pack is written. These three are
maintained as plain sources in the Markii repository under `packs/`, and a
pack you write yourself has the same shape.

## Loading a pack in a host

Installing a pack means handing its folder to whichever app renders your
notes. Two hosts show the shape.

In your own React application, a pack is a build-time dependency. You import
its built components and merge them into your registry with `installPacks`,
which namespaces each component and rejects two packs that claim the same
namespace. You pass the merged registry to `renderMark`. Nothing loads at
runtime: the pack is part of your bundle like any other import.

In an editor host, a pack is installed per device, because a pack decides
what code may run in your previews. The two reference hosts differ in how a
pack gets there, and the difference follows what each host is for.

The VS Code extension is the authoring host. It reads the `markii.packs`
setting, a list of folders you trust, which lives in your user settings
only, so a project you open can never add a pack on your behalf. An entry
always names a folder, never an archive file. It may name a pack folder
directly, or a folder that holds several: if the folder has no `pack.json`
of its own, each immediate subfolder that has one is treated as a pack, so
a single entry covers a directory of them.

```
packs/            <- one entry in the setting
  timeline/pack.json
  charts/pack.json
```

The scan goes one level down and no further. A relative entry resolves
against the open workspace, so the same entry loads a different folder in
each workspace you open. That can be exactly what you want, a pack kept
inside the project it serves, or a surprise, a pack that vanishes in the
next project, so the host notes relative entries in its diagnostics. For
one shared folder across projects, use an absolute path; a leading `~`
expands to your home directory, which keeps an absolute entry short.

VS Code also installs an archive for you. "Markii: Install Pack from File"
copies a `.mkp`'s contents into the extension's own storage and adds that
folder to `markii.packs`, and "Markii: Remove Installed Pack" takes one
back out, deleting the folder and its entry together.

The Obsidian plugin is the consuming host, and it manages its packs itself.
There is no folder list to edit. A pack arrives as a `.mkp` archive through
"Install Markii pack from file", and the plugin unpacks it into its own
directory, one folder per namespace. Which namespaces this device loads is
recorded device-locally, never in plugin data, so a vault you sync or share
carries none of your decisions about which code may run. A pack folder that
appears without being installed on this device, arriving through sync or
copied in by hand, is not loaded: the settings tab lists it as present but
not enabled here, and enabling it asks the same question installing asks.
The settings tab is also where an installed pack is removed, which deletes
its folder and its trust entry in one step.

Each pack folder holds a `pack.json`, the component sources or the prebuilt
script it names, and an optional `scripts/` folder of shared Lua. A host
validates each manifest and rejects namespace collisions, then does two
things: it makes the pack's Lua modules reachable from `require "name/..."`
in the Run path, and it loads the pack's components so they render. A note
that names a pack you have not installed still reads: its components show
the labeled fallback, and a quiet marker notes the missing pack.

### Installing a pack

Installing runs someone else's code in your previews, so a host asks first,
and the question says exactly that rather than talking about files. The
order matters and is part of the contract: the archive is validated first,
then consent is asked, then a namespace already in use asks before it is
replaced, and only after all of those does anything reach disk. An archive
that fails validation is reported and installs nothing, so a rejected pack
never leaves a half-written directory behind.

A namespace one of the host's own bundled packs already holds is refused at
install time. The host says so as it refuses, rather than accepting the
pack and skipping it quietly on the next load.

Installing, removing, and enabling all take effect at once. The host
reloads its packs and re-renders what is open, so a pack you just installed
renders without reopening anything.

### Two ways to run a pack: prebuilt and from source

A pack reaches a host in one of two forms, and they serve different people.

**Prebuilt, for distribution.** The pack ships `pack.json` plus a compiled
`webview.js`, a few kilobytes. The host uses it as-is: no compiler runs, so
it loads on every install of every host, including thin installs that carry
no compiler at all. This is the form to ship when other people will use
your pack.

**From source, for live authoring.** The pack ships its component sources,
and the host compiles them at load time: the sources the manifest names,
along with any relative modules and CSS they import. The result is cached
outside the pack's own folder so your files stay untouched, and rebuilt
when any file that went into the build changes. Reads during a build are
confined to the pack's own folder. This is the form for developing a pack:
edit a component, reopen the preview, see the change, with no toolchain of
your own.

Compiling from source is an optional host capability, and the reference
hosts split on it deliberately. VS Code is the authoring host and compiles
a source pack at load time. Obsidian is the consuming host and never
compiles: it loads the prebuilt form only, which is exactly what a `.mkp`
archive carries. A pack you develop in VS Code reaches Obsidian by
exporting it as an archive and installing that. A host that does not
compile reports a source-only pack on its diagnostics surface, naming what
it could not load, rather than failing silently.

When a pack folder holds both a `webview.js` and sources, the prebuilt
script wins and the sources are ignored. The host says so on its
diagnostics surface, as an informational line rather than a failure:
shipping both is a normal state for a pack you develop and also
distribute. While you are developing, delete the built file so your edits
take effect, and produce a fresh one when you ship.

The prebuilt filenames are a host convention layered on the pack
contract, the same way `webview.js` always was. The manifest gains no
field for them: `pack.json` keeps describing the sources, and a host
simply prefers the built files when they are present.

### What a prebuilt `webview.js` must do

A `webview.js` is not an opaque artifact of one toolchain. It is a contract,
so a pack author with their own build can produce one. Anything that
satisfies the rules below loads in any conforming host.

The script is an IIFE: loading it must not leave globals behind beyond the
one call it makes. Anything the build needs, a JSX shim included, goes
INSIDE that wrapper; a preamble emitted outside it leaks a global and breaks
this rule. That call is:

```js
window.__markiiRegisterPack(manifestJson, componentModules);
```

`manifestJson` is the pack's own `pack.json` as a STRING: the file's raw
text, passed through unchanged rather than parsed and re-serialized. A host
parses it itself. Passing an object instead is rejected, and re-serializing
it is a quiet way to lose fields, because anything the producer's parser did
not recognize is dropped on the way through.

`componentModules` maps each component's LOCAL name, the key as written in
the manifest, to an object with a `component` function and an optional
boolean `inline`. Only own properties are read, so an inherited value cannot
smuggle a component in.

React is not bundled into the script and is not imported at the top level.
The host's own bundle is the single place that sets `window.__markiiReact`
and `window.__markiiReactDom`, and a pack reads the same instance from there
rather than carrying its own copy. Because a pack script loads before the
host sets those globals, every read of them must happen inside a function
that runs at render time. Loading the script on its own, with
`window.__markiiReact` still undefined, must not throw. That is the test a
prebuilt script has to pass.

The host collects the queued registrations and folds them into its registry.
Registration order decides a namespace tie, so a host that ships packs of its
own registers them first.

## Styling a pack

A pack styles itself with an ordinary CSS import from a component:

```tsx
import './timeline.css';
```

The build bundles it into one stylesheet per pack, delivered alongside the
pack's components. There is no `styles` field in the manifest: the manifest
lists sources, and the build decides outputs. A host loads that stylesheet
after the document stylesheet and after its own theme layer, so a pack sees
resolved theme values and is not overridden by the host's broader rules.

Two rules keep packs from interfering with each other and with themes. Both
are reported as warnings in the host's diagnostics rather than enforced, so
a pack that breaks them still loads.

The first is color. Express every color through the `--mk-*` palette
documented in [integration.md](integration.md), or derive one from it, and
reserve a literal for a genuinely theme-invariant brand color:

```css
.mk-ana_timeline__rule {
  border-color: var(--mk-border);
  background: color-mix(in srgb, var(--mk-accent) 14%, var(--mk-bg));
}
```

A hardcoded color looks correct while you write it and becomes unreadable
the moment someone opens the note in a dark theme. This is the single most
common way a pack breaks for other people.

The second is naming. Every selector starts with `.mk-` followed by the pack
name and an underscore, so `.mk-ana_timeline__rule` for the pack `ana`. Because
two installed packs can never share a namespace, prefixed class names can
never collide either.

The component script follows a small registration convention. When it loads,
it calls a function the host provides and hands over its manifest and its
components; the host collects those and merges them the same way a React
application would. Pack components use the host's own renderer instance
rather than bundling their own copy. A host that loads packs this way limits
what it will load to exactly the configured folders, and never lets a note's
content decide what runs.

A prebuilt pack carries its stylesheet the same way it carries its script:
as a `webview.css` sitting next to `webview.js`. The host loads it exactly
like a stylesheet it compiled itself, keyed by the pack's namespace, so it
is ordered after the document stylesheet and the theme layer and is removed
again when the pack goes away. A pack with no styles simply ships no
`webview.css`, and its absence is not an error.

Do not inject a stylesheet from inside the component script. It works, but
the host can no longer remove it or order it against the theme, so the pack
leaks style into notes that are no longer using it.

## Sizing and alignment

Authors place a pack component with the same two attributes they use on
every block: `width` sizes its box, `align` places the box. Neither reaches
the component; the renderer applies both around it. Two rules on the pack's
side keep that predictable.

The first is how wide a component is by default. A component with a visible
frame, such as a card or a panel, fills the column, the way a standard card
does. A component with no visible frame and content-sized insides, such as
a table, a grid, a ring, or a chip, sizes to its own content:

```css
.mk-ana_grid {
  width: fit-content;
  max-width: 100%;
}
```

Without this, a frameless component looks left-aligned while its invisible
box fills the column, and an author who wraps it in `:::center` sees
nothing move. Either default is correct for the right component; the rule
is to choose deliberately rather than inherit block behavior by accident.

The second is naming. When a component lets an author align something
inside it, the attribute is named after the thing that moves, never
`align`. The standard set uses `text` for the text inside a block and
`label-align` for a divider's label. A pack aligning its own contents
follows the same pattern, so `align` keeps one meaning everywhere.

A container that wants to hand a setting to its children does so through
an attribute of its own and passes it down explicitly, the way the
standard row passes `text` to its cells. A child overrides with the same
attribute. There is no inherited scope for component attributes, on
purpose; the reasons are in [format.md](format.md) under what layout
deliberately cannot do.

## Exporting a pack for distribution

Once a pack works from source, VS Code's "Markii: Export Pack" command
turns it into the prebuilt form and writes it somewhere else. It asks which
pack when more than one is configured, then where to export it and what to
name the folder there, prefilled with the pack's own name. It compiles the
pack and writes `pack.json`, `webview.js`, `webview.css` when the pack has
styles, and any `scripts/*.lua` into that new folder. If the destination
already holds files from an earlier export, the command asks before
replacing them, and it reports where it wrote and how large the result is.

The pack's own source folder is never touched. Obsidian has no export
command: VS Code is the authoring host and owns pack packaging, while
Obsidian installs a pack another host produced, as a `.mkp` archive.

## A pack as a single file

A pack can also travel as one file. A `.mkp` archive is a zip of the pack's
prebuilt form, with the files at the root of the archive rather than inside a
folder:

```
pack.json
webview.js
webview.css     when the pack has styles
scripts/        when the pack ships Lua modules
```

An archive is named after what its manifest declares: `<name>-<version>.mkp`
when the manifest has a `version`, and `<name>.mkp` when it does not. The
filename claims exactly what the manifest says and nothing more, so a pack
with no declared version does not acquire an invented one.

A `.mkp` holds the prebuilt form only. `webview.js` is required, and a reader
never compiles anything out of an archive. An archive carrying leftover
component sources is still valid: the extra files are ignored, the same way a
prebuilt script already wins over sources sitting beside it.

Reading one is bounded the same way reading a `.mkz` bundle is, because it is
the same reader underneath. Entry sizes and the total are capped before
anything is decompressed, and every path goes through the same jail, so an
entry naming `../` or an absolute path is refused rather than written. A
malformed or hostile archive is reported and nothing is installed.

## What the reference project provides, and what it doesn't

This repository owns the contract: the `pack.json` format, the namespace and
engine rules, the registry merging, validation, and an authoring guide, with
`@markii/stdlib` as the exemplar component set. It deliberately does not own
an ecosystem: keeping the reference implementation free of one is what keeps
it small enough to trust.

The ecosystem lives in
[markii-packs](https://github.com/markii-org/markii-packs), a separate
repository holding a reviewed collection of packs, a starter template, and
the submission rules. Packs there are consumers of the contract on this
page, exactly like a pack you write yourself.
