# Changelog

All notable changes to Mark and the `@markii/*` packages are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/sadigaxund/markii/releases/tag/v0.1.0
