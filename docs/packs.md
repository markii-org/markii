# Component packs

A pack is how components and shared Lua modules travel between people. The
contract, the namespace rules, the registry merging, and the sandboxed
`require` are implemented, and both reference hosts (the VS Code extension
and the Obsidian plugin) load packs. This page describes that shipped
contract. There is no pack registry or marketplace, and none is planned
here; the last section says why.

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

### Describing a component

A `components` entry can be the string shorthand shown above, a source
path, or an object that adds metadata:

```json
"components": {
  "timeline": {
    "source": "./Timeline.tsx",
    "description": "A dated event timeline.",
    "kind": "leaf"
  }
}
```

`description` is one short line a host shows wherever it lists components,
such as the insert picker. `kind` names the directive form the component
renders as: `container` for `:::ana_timeline ... :::`, `leaf` for
`::ana_timeline{}`, `inline` for `:ana_timeline[]`. A host assumes
`container` when `kind` is absent, so a leaf or inline component should
declare it. Both forms may mix in one manifest, and older string-only
manifests are unaffected.

The failure posture matches the rest of the manifest: a bad `kind`, an
empty `description`, or a missing `source` fails validation for the whole
`pack.json`, and the host reports the pack as skipped with the reason. An
unrecognized key inside a component object is only a warning, so a field
added in a future version cannot break the pack on an older host.

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
than copied per note. For helpers that only matter inside one vault, the
vault library fills the same role locally (see
[scripting.md](scripting.md)); code meant to travel belongs in a pack.
Sharing *data* between notes is a different mechanism entirely, the
published-value store, and never involves packs.

## Collision and install rules

Flat and boring on purpose. Installing two packs with the same namespace is
rejected at install time. A vault library that shadows an installed pack's
namespace wins, with a visible warning. There is no transitive dependency
resolution and there are no version ranges.

## Loading a pack in a host

Installing a pack means handing its folder to whichever app renders your
notes. Two hosts show the shape.

In your own React application, a pack is a build-time dependency. You import
its built components and merge them into your registry with `installPacks`,
which namespaces each component and rejects two packs that claim the same
namespace. You pass the merged registry to `renderMark`. Nothing loads at
runtime: the pack is part of your bundle like any other import.

In an editor host, packs are installed by naming folders you trust. The VS
Code extension uses the `markii.packs` setting, which lives in your user
settings only, so a project you open can never add a pack on your behalf.
The Obsidian plugin keeps its list in device-local storage rather than in
plugin data, so a vault you sync or share carries none of your decisions
about which code may run.

Each folder holds a `pack.json`, the component sources it names, and an
optional `scripts/` folder of shared Lua. A host validates each manifest and
rejects namespace collisions, then does two things: it makes the pack's Lua
modules reachable from `require "name/..."` in the Run path, and it loads
the pack's components so they render. A note that names a pack you have not
installed still reads: its components show the labeled fallback, and a quiet
marker notes the missing pack.

A configured folder may either be a pack itself or hold several. If the
folder has no `pack.json` of its own, each immediate subfolder that has one
is treated as a pack, so a single entry covers a directory of them:

```
packs/            <- one entry in the setting
  timeline/pack.json
  charts/pack.json
```

The scan goes one level down and no further. A relative entry resolves
against the open workspace or vault, so the same entry loads a different
folder in each one you open. That can be exactly what you want (a pack
kept inside the vault it serves) or a surprise (a pack that vanishes in
the next vault), so a host notes relative entries in its diagnostics. For
one shared folder across projects, use an absolute path; a leading `~`
expands to your home directory, which keeps an absolute entry short.

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

Compiling from source is an optional host capability, because the compiler
is a sizeable runtime the host may not carry. An install without it (for
example, an Obsidian install fetched by an automated installer, which
downloads only the plugin's three core files) cannot build a pack that
ships source. The host reports that on its diagnostics surface, naming the
install that would restore the capability, rather than failing silently or
dumping a compiler error. A prebuilt pack loads either way.

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
Obsidian loads a pack another host produced, either from source or as an
exported prebuilt folder.

The command needs the compiler, so an install that does not carry one
cannot run it. It says so plainly and names the install that would restore
it.

## What the reference project provides, and what it doesn't

This repository owns the contract: the `pack.json` format, the namespace and
engine rules, the registry merging, validation, and an authoring guide, with
`@markii/stdlib` as the exemplar component set. It deliberately does not own
an ecosystem. There is no pack registry, no marketplace, no scaffolding
tool, and none is planned here; if such things ever exist, they will be
separate projects, so that the reference implementation stays small enough
to trust.
