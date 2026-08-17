# Changelog

All notable changes to Mark and the `@markii/*` packages are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Layout wrapper containers (`@markii/react`, `@markii/stdlib`)**:
  `:::center`, `:::right`, `:::wide`, `:::narrow`, `:::full` — five registry
  aliases of one wrapper component that carry DESIGN.md §4's closed layout
  presets to plain markdown a directive attribute cannot reach (a GFM table
  or a bare image has no `{...}`). Attribute-free by design; nesting a width
  wrapper inside an alignment wrapper composes. `@markii/react/components`
  exports `createLayoutWrapper`, `LAYOUT_WRAPPER_PRESETS`, and
  `LayoutWrapperPreset`; `defaultRegistry` gains the five names, and
  `@markii/stdlib`'s `STANDARD_COMPONENTS` gains their contracts. New
  conformance fixture `18-layout-wrappers`.
- **Failure presentation parity (`@markii/react`)**: `MarkComponentProps`
  gains optional `dataError` and `dataFailureKind`, so `stat`/`progress`/
  `chart` present a failed `data=` binding exactly the way `:value[...]`
  already did — a `title` tooltip plus a modifier class hook
  (`mk-stat--tier-blocked`, `mk-chart--stale`, ...), never body text. Both
  props are supplied only for a directive that had a `data=` attribute, and
  `dataFailureKind` only for a genuine `error` resolution.

## [0.2.0] - 2026-08-17

Layout, cross-note data sharing, a block-level render primitive, and a
hardened scripting failure model. This release adds public API and changes
some existing behavior, so it is a minor version, not a patch.

### Added

- **Layout presets (`@markii/react`, `@markii/stdlib`)**: `width` and `align`
  as reserved directive attributes mapped to a closed set of theme classes,
  and a `:::row{cols=2|3|4}` container for side-by-side dashboards. Invalid
  values degrade silently; plain viewers stack.
- **Vault-published values (`@markii/runtime`, `@markii/core`,
  `@markii/react`)**: the bulletin board — a script fence with the bare
  `publish` attribute publishes its named value to a vault-level store; any
  note reads it with an `@`-prefixed name (`data=@gh.stars`). A read-only
  `VaultStore` plus a capability-style `VaultWriter` (possessing the writer is
  the publish grant), one writer per name.
- **Block-level render primitive (`@markii/core`, `@markii/react`)**:
  `nodeToHast` and `renderMarkNode` render a single parsed node with the same
  contract as the whole-document path — a pure render function, not an editor.
- **Failure taxonomy (`@markii/runtime`, `@markii/lua`)**: a closed
  `FailureKind` (script-error, capability-denied, tier-blocked, limit) derived
  from non-spoofable error identity, replacing message-string classification.
- **Grant-closure key (`@markii/runtime`)**: `computeGrantKey` hashes a note's
  full executable closure (scripts, `src` files, vault-library and pack
  modules) so a permission grant is re-prompted when any of that code changes.
- `renderMark` gained an optional fourth `vault` argument (existing three-arg
  calls are unchanged); `@markii/core` exports `isBareAttribute`.

### Changed

- **Chart** no longer accepts pixel `width`/`height` attributes — components
  size to their container and layout presets are the sizing story.
- Boolean fence-meta attributes (`publish`, `open`) are **bare-only** and fail
  closed: `open=false` no longer opens a script marker.
- Script names must match `[A-Za-z_][A-Za-z0-9_-]*`; a fence whose name has a
  dot (or other invalid character) is display-only, not runnable.
- `messageForFailure` was removed in favor of the structured `FailureKind`.

### Fixed

- **Sandbox (`@markii/lua`)**: the marshal walk's node/depth/key caps are now
  immune to a script rebinding `error`/`type`/`pairs`/`math.floor`; embedded
  NUL bytes in a returned string are rejected rather than silently truncated;
  `runScript` never raw-throws, even on an unexpected internal exception.
- **Render primitive (`@markii/core`)**: caller-supplied `data.hName`/
  `hProperties`/`hChildren` are stripped from an input node, closing an
  injection path unique to the AST-accepting entry point.

### Security

- A full evidence-backed re-audit of the `@markii/lua` sandbox
  (`docs/lua-sandbox-audit.md`); the two findings above were its result.

## [0.1.0] - 2026-08-17

First public release.

Mark is a markdown format that renders your own components inline. It is
CommonMark and GitHub-Flavored Markdown plus a small directive syntax, with
optional sandboxed Lua scripting that feeds live data into the page. A `.mk.md`
file stays readable as plain markdown in any editor, and a Mark-aware renderer
adds the components on top. The product is the format and its reference library,
not an application.

This release ships the format, its conformance corpus, and a reference
implementation split across six packages.

### Added

- **Parser (`@markii/core`)**: CommonMark and GFM to an AST, generic directive
  tagging, and a URL-sanitizing tree for renderers. Zero React dependency.
- **Component contracts (`@markii/stdlib`)**: the neutral schema every renderer
  targets, so the same component names mean the same thing across toolkits.
- **Reference renderer (`@markii/react`)**: a registry that maps a directive
  name to a component, its attributes to props, and its inner markdown to
  children, with a labeled fallback box for unknown names so a page never
  breaks. Twelve standard components ship with it: callout, card, badge,
  details, figure, tabs and its tab child, kbd, rating, and the data-bound stat,
  progress, and chart.
- **Value store and run orchestrator (`@markii/runtime`)**: named script
  results, a pure read path, and a trigger-to-capability gate that keeps auto
  and scheduled runs read-only.
- **Lua sandbox (`@markii/lua`)**: Lua 5.4 in WebAssembly, started in an empty
  environment with host-injected capabilities and limits on instructions, wall
  clock, memory, and fetch size.
- **Bundle handling (`@markii/bundle`)**: the `.mkbundle` container for a
  document with its scripts, assets, and cache, with a path jail for
  bundle-relative access.
- **Conformance corpus**: `.mk.md` inputs paired with their expected AST as
  JSON, so a renderer written in any language can verify against the same
  fixtures.
- **Documentation and demo**: the design spec (`DESIGN.md`), a README, and a
  hosted playground.

[0.2.0]: https://github.com/sadigaxund/markii/releases/tag/v0.2.0
[0.1.0]: https://github.com/sadigaxund/markii/releases/tag/v0.1.0
