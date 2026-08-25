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

## Names and namespaces

An author references a pack component by typing the prefixed name
themselves: `:::ana-timeline`. Nothing is auto-registered under a bare name;
like a language import, the author opts in by typing the prefix. Directive
names cannot contain `:` (it is reserved syntax), so the namespace separator
is `-` or `_`.

The prefix is added by the host, not written in the manifest. A manifest key
names the component *inside* its pack, and the directive an author types is
the pack name joined to that key:

```
pack "ana" + component "timeline"  ->  :::ana-timeline
```

This is the one place pack authors reliably go wrong. Naming the manifest
key `ana-timeline` inside a pack already called `ana` produces the directive
`ana-ana-timeline`, which no note types, so every use of it falls back to
the unknown-component box. Keep manifest keys bare.

Your own components stay unprefixed; prefixes exist for other people's
packs. On a literal collision the registry resolves last-wins by merge
order, but prefixes make collisions a non-issue in practice. The bundle's
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

The scan goes one level down and no further. Prefer absolute paths: the
list is scoped to you rather than to a project, so a relative entry means a
different folder in every workspace or vault you open, and a host reports
one as deprecated in its diagnostics. A leading `~` expands to your home
directory, which keeps an absolute entry short.

A pack does not need to ship a built artifact. The host compiles the
component sources its manifest names, along with any relative modules and
CSS they import, caches the result outside the pack's own folder so your
files stay untouched, and rebuilds when any file that went into the build
changes. Reads during a build are confined to the pack's own folder. A pack
that does ship a prebuilt script is used as-is.

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
.mk-ana-timeline__rule {
  border-color: var(--mk-border);
  background: color-mix(in srgb, var(--mk-accent) 14%, var(--mk-bg));
}
```

A hardcoded color looks correct while you write it and becomes unreadable
the moment someone opens the note in a dark theme. This is the single most
common way a pack breaks for other people.

The second is naming. Every selector starts with `.mk-` followed by the pack
name and a hyphen, so `.mk-ana-timeline__rule` for the pack `ana`. Because
two installed packs can never share a namespace, prefixed class names can
never collide either.

The component script follows a small registration convention. When it loads,
it calls a function the host provides and hands over its manifest and its
components; the host collects those and merges them the same way a React
application would. Pack components use the host's own renderer instance
rather than bundling their own copy. A host that loads packs this way limits
what it will load to exactly the configured folders, and never lets a note's
content decide what runs.

## What the reference project provides, and what it doesn't

This repository owns the contract: the `pack.json` format, the namespace and
engine rules, the registry merging, validation, and an authoring guide, with
`@markii/stdlib` as the exemplar component set. It deliberately does not own
an ecosystem. There is no pack registry, no marketplace, no scaffolding
tool, and none is planned here; if such things ever exist, they will be
separate projects, so that the reference implementation stays small enough
to trust.
