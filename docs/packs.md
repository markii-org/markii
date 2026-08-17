# Component packs

A pack is how components and shared Lua modules travel between people. This
page describes the design. Packs are specified but not yet implemented; the
registry, contracts, and `require` seams they plug into exist today, and
this page is the target they will be built against.

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

## What the reference project provides, and what it doesn't

This repository owns the contract: the `pack.json` format, the namespace and
engine rules, the registry merging, validation, and an authoring guide, with
`@markii/stdlib` as the exemplar component set. It deliberately does not own
an ecosystem. There is no pack registry, no marketplace, no scaffolding
tool, and none is planned here; if such things ever exist, they will be
separate projects, so that the reference implementation stays small enough
to trust.
