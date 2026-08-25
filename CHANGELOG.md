# Changelog

All notable changes to Markii and the `@markii/*` packages are recorded here. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **A theming contract: `doc.css` now exposes a fifteen-token palette** —
  the reference stylesheet previously hardcoded 36 colors, so every host had
  to restyle it selector by selector: 60 overrides in the VS Code layer, 54
  in the Obsidian one, each an opportunity to miss one. A real user hit the
  consequence as unreadable gray-on-white cards in dark mode. Hosts now map
  fifteen custom properties on `.doc` and every finer shade is derived from
  them by three fixed mixes, so a remapped palette makes every callout,
  badge, and chart variant correct in both directions with no further work.
  The palette is documented in `docs/integration.md` and is a public
  contract: renaming a token is a breaking change.

  The derivations use `color-mix` guarded by `@supports`, with the previous
  literal values as the fallback, because `doc.css` is embedded verbatim into
  the static HTML renderer's output and a custom property that fails to parse
  does not fall back, it vanishes. Three tests hold the line: `doc.css` may
  contain no raw color literal outside its token blocks, and each host fails
  until its layer maps every token.

- **The extension compiles a pack's component sources** — a pack previously
  had to ship a prebuilt registration script that nothing in this project
  produced, so a pack of ordinary `.tsx` files loaded, claimed its namespace,
  and contributed no components at all, silently. Sources are now compiled on
  load with `esbuild-wasm`, cached outside the pack's own folder so the
  user's file tree stays clean, and rebuilt only when a source changes. A
  pack that does ship a prebuilt script is still used as-is.
- **A `markii.packs` entry may name a folder of packs** — a configured folder
  with no `pack.json` of its own now has each immediate subfolder checked for
  one, so a directory of packs is a single entry. One level, no recursion.
- **A diagnostics surface for the extension** — an output channel named
  Markii, revealed by the new command `Markii: Show Diagnostics`, listing
  every pack that loaded, every folder that did not and why, and every
  deprecated configuration entry.
- **The Obsidian plugin runs scripts and loads packs** — it is now a full
  second host rather than a viewer: a Run command backed by the same
  terminatable worker isolate and watchdog the extension uses, grant prompts
  as modals, auto-run and scheduled refresh at the read-only tier, and
  component packs compiled from source exactly as in VS Code.

  Everything that authorizes execution or network access is stored
  device-locally rather than in plugin data, because plugin data lives inside
  the vault and travels with Sync and with any shared copy. Obsidian has no
  equivalent of an application-scoped setting, so this replaces it. A test
  fails the suite if a grant path ever reaches vault-backed storage.

- **The script-running host layer and the pack builder are shared** — both
  live in a private, unpublished workspace package that the two apps consume,
  so there is exactly one copy of the tier gate, the grant model, address
  pinning, the isolate watchdog, pack discovery, and the builder. It has no
  npm presence and is absent from the release workflow.

  Pack compilation uses esbuild-wasm's in-process WebAssembly path in both
  hosts. Its Node path spawns a `node` child process, and Obsidian's Electron
  renderer has no `node` binary, so that path fails there outright. The
  in-process path also measured faster.

- **Packs can style themselves** — a pack's components import CSS the
  ordinary way, the build bundles one stylesheet per pack, and the host loads
  it after the document stylesheet and its own theme layer so a pack sees
  resolved theme values. Without this a pack rendered entirely unstyled, its
  CSS having no way to travel with it. There is deliberately no manifest
  field: the manifest lists sources, the build decides outputs. Two authoring
  rules are reported as diagnostics rather than enforced, so a pack that
  breaks them still loads: colors go through the `--mk-*` palette, and
  selectors carry the pack's own `.mk-<name>-` prefix, which makes class
  collisions impossible for the same reason namespace collisions already are.
- A leading `~` in a `markii.packs` entry expands to the home directory.

### Changed

- **The extension's network provider is built on `node:https` rather than
  `fetch`** — `fetch` cannot pin where a socket connects without an undici
  dispatcher, and adding a dependency for that is out of scope. Every
  existing protection survives the port and is pinned by the tests that
  covered it before: manual redirect following with a per-hop host check, the
  streamed response-size cap with its `content-length` pre-check, the refusal
  of credential-bearing URLs, and certificate verification. The default
  headers `fetch` had been adding are now set explicitly, because dropping
  them would have broken every note reading the GitHub API (403, no user
  agent) while every local-server test stayed green.
- `RunJob`, `SpawnRunOptions`, and `RunOnceOptions` gained an optional
  `netPolicy`, and `createNetProvider` is now exported for testing. An absent
  `netPolicy` fails closed.
- **Both host theme layers are now token maps** — the VS Code and Obsidian
  stylesheets drop their per-selector overrides in favor of mapping the
  fifteen-token palette onto each host's own theme variables.

### Deprecated

- A relative entry in `markii.packs` still resolves as before, but is
  reported in diagnostics. The setting is user-scoped, so a relative entry
  means a different folder in every workspace; absolute paths are preferred.

### Fixed

- **Failures that were recorded and never shown** — three separate silent
  failures were found in one evening by a user bisecting by hand, so
  AGENTS.md now states the principle directly: clean is not silent, and a
  failure reachable from neither the note nor the host's diagnostics surface
  is a bug as severe as an error dump. Acting on it: a pack that fails to
  load reports the reason and shows a quiet marker in the preview, an auto or
  scheduled run leaves a visible trace so a working schedule is
  distinguishable from a broken one, and an inline component written with no
  content carries a marker explaining the likely mistake instead of rendering
  an empty box.
- The Marketplace publish step no longer fails a re-run of an already
  published tag. Its pre-check raced Marketplace propagation, which turned
  the second 0.7.2 run red for a version its own first run had just
  published; the publisher's own "already exists" is now treated as success.
- The VSIX no longer ships test fixtures.

### Security

- **The network jail now resolves and pins addresses, closing DNS rebinding
  and private-range SSRF (issue #10)** — `docs/security.md` previously
  documented this as an accepted limitation of hostname grants. Every hop of
  a request now resolves its host once, vets every address the resolver
  returned, and connects to the vetted address, so the gap between resolving
  and connecting is closed by construction. The certificate check and the
  `Host` header still use the real hostname, so pinning weakens nothing
  about server identity.

  Addresses are judged by scope rather than by a short list of private
  blocks: loopback, private, link-local, carrier-grade NAT, multicast, and
  the reserved and documentation ranges are restricted, including the ones
  that hide inside an IPv6 wrapper (IPv4-mapped, IPv4-compatible, 6to4,
  NAT64), which is how incomplete filters are usually walked around. A grant
  naming a literal address or `localhost` is still honored at any scope, so
  pointing a note at a local development server keeps working; a grant
  naming a host may only be reached at a public address, and a mixed answer
  is refused outright rather than filtered. The new
  `markii.allowPrivateNetworkAddresses` setting is the deployment opt-in for
  internal DNS that legitimately points names at private space, and it is
  user-scope only.

  Verified against the real resolver and the real network, not only injected
  answers: a granted public name whose genuine DNS answer is loopback is
  refused, while a real GitHub API note still completes through TLS and a
  redirect.

- **Dedicated adversarial pass over auto-run and scheduled execution (issue
  #12)** — the tracked next step `docs/security.md` named after 0.7.1 moved
  script execution off the explicit click for the first time. The pass ran
  against real worker threads, the real Lua sandbox, and real local HTTP
  servers. The tier gate and the non-interactive grant rule held under every
  attack tried: repeated scheduled and auto ticks could not reach POST,
  PATCH, or a bundle write (even with the write declared in the manifest and
  granted), could not escalate by seeding a cache entry for a later tick, and
  could not do any of it through a pack's `require` either; and the
  no-new-network claim was measured at the server's own request counter,
  which stayed at zero.

  One real gap and two robustness bugs came out of it, all fixed here:

  - `markii.runOnOpen` and `markii.refreshIntervalSeconds` declared no
    configuration scope, and an unscoped VS Code setting defaults to window
    scope, which a workspace's `.vscode/settings.json` can set. A repository
    could therefore enable unattended execution for anyone who opened it. The
    network gate still held (a fresh clone has no stored grant, and an auto
    run never prompts), so the exposure was capability-free sandboxed
    execution rather than any reach outward, but the "no code runs without a
    user gesture" property was broken. Both settings are now pinned to
    `"scope": "application"`, matching `markii.packs`, and a test pins every
    setting that can cause an unattended run.
  - A corrupt entry in the persisted value store made rehydration throw
    instead of degrading, which would have silently skipped the stale re-seed
    and the run-on-open that follows it. Unusable entries are now skipped.
  - A value named `__proto__`, which is a legal script name, was silently
    dropped by output objects built with plain assignment. The rehydration,
    merge, and wire-scrub paths now build their output so every name
    survives, matching `@markii/runtime`'s own value store.

  The pass's probe suites are committed as product code
  (`scheduled-timer-tier.probe.test.ts`,
  `scheduled-grant-network.probe.test.ts`,
  `contributes-runopen-scope.probe.test.ts`,
  `values-persistence-protocol.probe.test.ts`), and `docs/security.md`
  records the result, the fixes, and one honest coverage limit: the timer
  lifecycle itself lives in the module that imports the editor API and so was
  reviewed by reading rather than execution.

## [0.7.2] - 2026-08-24

No library code changed in this release: every `@markii/*` package is
byte-identical to 0.7.1 and moves only to keep the lockstep version line
intact.

### Changed

- **The playground now seeds its editor from the repository's
  `README.mk.md`.** The hosted demo previously showed
  `apps/playground/demo.mk.md`, a second copy of the same tour that had to be
  kept in step with the file at the repository root by hand. That copy is
  gone: `README.mk.md` holds the content the app was showing, and the
  playground imports it. Editing `README.mk.md` is now the way to change what
  https://sadigaxund.github.io/markii/ displays.

  The app's posture is unchanged. The import is resolved at build time, so the
  document ships as a frozen string inside the bundle; every visitor starts
  from a fresh in-memory copy, and nothing typed in the editor is persisted or
  written back to the file.

- **GitHub Pages republishes when `README.mk.md` changes.** The deploy
  workflow's path filter now includes the file, so an edit to the document
  reaches the hosted playground without a manual `workflow_dispatch`.

## [0.7.1] - 2026-08-24

### Added

- **VS Code extension: scheduled/auto refresh and value-store persistence for
  monitoring notes (issue #11)** — three additions, all within the read-only
  tier the runtime already defined:
  - _Value persistence (gap 1)._ A note's last run values are persisted and
    re-shown, marked stale, when its preview reopens — so a monitoring note
    renders its last figures instantly and offline, before or without a
    re-run. A failed re-run keeps the last-known-good value rather than wiping
    it (`mergePersistedValues`).
  - _Scheduled refresh (gap 2)._ A new `markii.refreshIntervalSeconds` setting
    (0 = off, minimum 5s) drives periodic re-runs at the `scheduled`
    (read-only) trigger.
  - _Run-on-open (gap 3)._ A new `markii.runOnOpen` setting (off by default)
    runs a note once when its preview opens, at the `auto` (read-only)
    trigger.

  Auto and scheduled runs resolve grants NON-INTERACTIVELY: they reuse only
  the hosts the user already granted by hand for that exact executable
  closure, never prompt on a timer or on open, and never widen network
  access. The trigger flows through `runOnce` → `spawnRun` → the worker, where
  `@markii/runtime`'s `tierForTrigger` enforces the read-only tier
  (no POST/PATCH/bundle-write) regardless of grants — verified end-to-end
  through a real worker in `worker-trigger.test.ts`.

### Security

- **Pack arc hardening (pass-3 pentest report, `docs/security.md`)** — two LOW
  findings closed: **H-1** pins the `markii.packs` `"scope": "application"`
  declaration with a `contributes.test.ts` assertion, so the user-only scope
  that keeps a workspace's `.vscode/settings.json` from injecting packs cannot
  be silently removed; **H-2** adds a 1 MB per-file cap when pre-reading a
  pack's `scripts/*.lua`, matching the bundle snapshot's posture. The pass-3
  probe suite (`packages/markii-lua/src/require-pass3.probe.test.ts`, 22
  cases) is committed as permanent product code.

## [0.7.0] - 2026-08-24

### Added

- **`@markii/pack`: the component pack contract (issue #3, slice 0)** — a new
  neutral package defining `pack.json`'s manifest shape
  (`name`/`engine`/`components`), hand-rolled validation (`parsePackManifest`),
  and the namespace rules from `docs/packs.md`: pack-name and
  local-component-name validation (lowercase-kebab), rejection of the reserved
  bundle segments `scripts`/`assets`/`.cache` as a namespace, directive-name
  composition (`ana` + `timeline` → `ana-timeline`), and a namespace-collision
  predicate. No React, no parsing, no registry loading, no filesystem reads:
  those are later slices.
- **`@markii/pack`: `resolveUses()` and `isValidPackNameShape()` (issue #3,
  slice 2)** — resolves a note's frontmatter `uses:` declaration against a
  host's installed pack namespaces, distinguishing "not declared" from
  "declared but not installed" (`docs/packs.md`). Host-facing metadata only:
  no loading, no registry.
- **`@markii/react`: pack loading and registry namespacing (issue #3,
  slice 1)** — `loadPack(manifest, componentModules)` builds a `Registry`
  from a `@markii/pack` manifest, namespacing each component under
  `composeDirectiveName(pack, local)`; a manifest whose `engine` is not
  `"react"` yields an empty registry so its directives fall back cleanly.
  `installPacks(packs, base?)` merges several packs onto a base registry and
  rejects the install (no partial merge) when two packs share a namespace.
- **VS Code extension: pack loading (issue #3, slice 5)** — a `markii.packs`
  setting (user-scope only) names folders trusted as installed packs.
  Installed packs' components render in the preview via a documented
  registration convention (each pack ships a `webview.js` that calls
  `window.__markiiRegisterPack`, sharing the one webview React instance), and
  their shared Lua modules are reachable from `require "packName/…"` in the
  Run path. A note's `uses:` frontmatter is resolved against installed packs,
  with a quiet marker for anything missing. Pack scripts load only from the
  configured folders (via `localResourceRoots`), never from note content.

### Changed

- **VS Code extension: preview UX** — `.mk.md` now uses a dedicated `markii`
  language id instead of the built-in `markdown` one, so VS Code's own markdown
  preview buttons (Open Preview, Open Preview to the Side, split) no longer
  double up with Markii's on the editor title bar; markdown highlighting is
  preserved via a base grammar that re-exposes the built-in markdown grammar.
  The **Run Scripts** button now appears only on the preview panel's title bar
  (once, over the rendered view) instead of also on the source editor. Added a
  **Markii: Add Pack Folder…** command (a folder picker that appends to the
  user-scoped `markii.packs` setting) so packs can be installed without
  hand-editing settings JSON.
- **`@markii/lua`: the sandboxed `require` is now wired (issue #3, slice 3,
  spec §8)** — `require` resolves bundle-local modules (`require "scripts/…"`,
  reusing `@markii/bundle`'s path-jail via the same `ScriptView`) and a
  pack-module seam (an injected `PackModuleResolver`), with a per-run module
  cache, cycle detection, and bytecode rejection. A resolved module runs as a
  protected chunk sharing the run's globals, capabilities, and limits.
  `require` is now always a real function in the sandbox (previously absent);
  with no bundle or resolver configured every call denies cleanly. The
  superseded `buildRequireStub`/`NOT_YET_SUPPORTED_MESSAGE` exports are
  removed.
- **`@markii/lua`: require-jail hardening (issue #3, slice 4)** — `runScript`
  now asserts, fail-closed, that no code-loading primitive (`load` or the
  private captured `__smd_load_raw`) is reachable before any user code runs, so
  the sandbox-assembly path can never silently regress into leaving the
  compiler exposed. The adversarial probe suite gained cases for the internals
  never leaking to user code, deeper require cycles, non-string `require`
  arguments, and a throwing pack resolver.

## [0.6.0] - 2026-08-24

### Added

- **`@markii/html`: a second, framework-free renderer (issue #2)** — the
  toolkit-neutrality proof. A new platform package under
  `packages/platforms/` that consumes `@markii/core`'s sanitized hast and
  emits an HTML string, with zero React, for stopped-changing documents
  (publishing, CI, email, archive). `renderMarkToHtml(text, registry)` and
  `renderMarkNodeToHtml(node, registry)` mirror the React renderer's L1
  contract: registry resolution with aliases, string attributes,
  children-as-markdown, the unknown-directive and form/kind-mismatch
  fallbacks (same markup and classes as `@markii/react`, so one stylesheet
  covers both), layout interception (`width`/`align`), script-fence folding,
  hostile-registry safety, and the never-throw guarantee. Components are
  `(attributes, childrenHtml, ctx) => string` with `ctx.esc`.
- **`@markii/html/components`: the standard component set** — HTML-string
  emitters for callout, card, badge, details, figure, tabs/tab, kbd, rating,
  row, cell, and the layout wrappers (center/left/right/wide/narrow/full via
  `createLayoutWrapper`), plus `defaultHtmlRegistry`. Markup and classes match
  `@markii/react` byte-for-byte, so `@markii/react/doc.css` styles both
  renderers; `figure` runs `src` through `@markii/core`'s `isSafeUrl` (the same
  sanitizer gate the React figure uses). `tabs` renders every panel in document
  order with no JS switcher: this package is zero-JS by design, and a string
  component cannot recover each tab's `label` from already-rendered children (a
  documented limitation).
- **`@markii/html`: value binding and the data-bound `stat`/`progress`/`chart`
  trio (issue #2, slice 3)** — `renderMarkToHtml`/`renderMarkNodeToHtml` now
  take optional `store`/`vault` arguments (`@markii/runtime`'s `ValueStore`/
  `VaultStore`), and `HtmlRenderContext` grew `resolve(name)`, `valueMarker
(name)`, and the per-directive `data`/`dataStatus`/`dataError`/
  `dataFailureKind` fields — the string engine's equivalent of
  `@markii/react`'s `MarkComponentProps`, since a plain `(attributes,
childrenHtml, ctx) => string` component has no room for a fourth argument.
  `:value[name]` and every `data=name` attribute resolve dotted paths and
  `@`-prefixed vault names, matching `@markii/react`'s `ValueDirective`/
  `resolveDataAttribute` presentation exactly (missing/stale/failure-kind
  classes, tooltip wording). `stat`, `progress`, and `chart` are now
  registered in `defaultHtmlRegistry`, with markup and classes identical to
  `@markii/react`'s versions — `chart` is a dependency-free inline-SVG string,
  matching the React chart's geometry byte-for-byte. Resolution logic
  (`resolveScopedPath`, `safeRead`), failure presentation
  (`dataStateClassName`, `failureTitle`), and value formatting
  (`stringifyStoredValue`) are ported from `@markii/react`'s internal modules
  into this package's own `src/resolve.ts` / `src/failure-presentation.ts` /
  `src/value-format.ts`, since the two renderers are independent
  implementations of the same contract rather than a shared dependency.
- **`@markii/html`: the L1 conformance corpus now runs against this engine**
  (issue #2's success criterion) — every fixture in `conformance/` renders
  through `renderMarkToHtml` with `defaultHtmlRegistry` without throwing.
- **`@markii/html`: `exportHtmlDocument(body, options?)`** — wraps an
  already-rendered document body in a complete, self-contained HTML document
  (doctype, `<head>`, a `<style>` block, a `<div class="doc">` wrapper), for
  publishing a rendered note as a standalone file. The embedded stylesheet is
  `@markii/react`'s `doc.css`, generated into this package at build/test time
  (`scripts/generate-doc-css.ts`) rather than duplicated by hand, so the two
  renderers can never drift on document rhythm or component internals.

## [0.5.0] - 2026-08-23

### Added

- **Running `.mkz` bundles in the VS Code extension**: a bundle (directory
  or zip form) opens and previews, and its scripts run under the same
  worker/watchdog/grant model as a bare note, now with the bundle
  filesystem capability. The worker holds no live archive or disk handle:
  the host passes an in-memory snapshot of the files a run may touch, backs
  a path-jailed `ScriptView` over it, and persists `.cache/` writes
  (directory form to disk, zip form to extension storage). The capability a
  script gets is the manifest-declared intersect the user-granted set;
  writes stay jailed to `.cache/`. Grants are seeded from the manifest's
  declared hosts, and `src=` script content is part of the grant-key
  closure, so editing a bundle script re-prompts. The arc had an
  adversarial pass; its findings are fixed below.
- **`BundleStorage.size(path)` (`@markii/bundle`)**: returns a file's byte
  length without reading its contents, in both storage forms, so a caller
  can enforce a size budget before materializing a file.
- **Optional `document` manifest field (`@markii/bundle`)**: `manifest.json`
  may name a bundle-relative path to the document to open in place of the
  conventional `note.mk.md`. `parseManifest` validates it as a string;
  path-jailing stays with `normalizeBundlePath` at use time.
- **`netProviderDenial` / `isNetProviderDenial` (`@markii/lua`)**: a
  `NetProvider` marks a policy denial (a blocked redirect, an over-size
  body, too many hops) by throwing `netProviderDenial(message)`. The sandbox
  recognizes the brand on the JS side of the provider call, records the
  denial on its non-spoofable out-of-band handle, and re-throws a sanitized
  capability error, so a provider-level denial classifies as
  `capability-denied` without a host reclassifying it from the error text.

### Fixed

- **`bundle.read` of a missing path (`@markii/lua`)**: reading a path that
  does not exist now resolves to Lua `nil` instead of throwing, so the
  read-if-present idiom works. The crash came from a wasmoon marshalling
  quirk when a host-side async result resolved with JS `null`; the
  capability now resolves `undefined` for an absent file. `bundle.exists`,
  `bundle.write`, and capability-denial behavior are unchanged.
- **Bundle files size-checked before reading (VS Code extension)**: a
  script, document, or manifest file in a delivered `.mkz` bundle is
  size-checked before it is read, so an oversized file can no longer force
  a large allocation in the extension host merely by being opened or run
  (the directory-form snapshot path was previously read-then-cap).
- **`src=` script edits re-prompt (VS Code extension)**: editing a bundle
  script referenced by `src=` now invalidates the note's stored grant and
  re-prompts, instead of silently running the new code under the old grant.
- **Zip archive size-checked before opening (VS Code extension)**: the zip
  form of a `.mkz` is read from disk whole to open it, so its on-disk size
  is now checked first and an oversized archive is refused before the read.
  The per-entry caps only apply to an already-opened archive, so without
  this a multi-gigabyte `.mkz` could exhaust the extension host purely by
  being opened (docs/archive/PENTEST-REPORT-2026-08-23.md §9.3, P2-b).
- **Net-denial classification no longer rides a Lua-visible tag (VS Code
  extension + `@markii/lua`)**: a provider policy denial was marked by a
  per-run tag carried inside the thrown error message, which a script's own
  `pcall`/`tostring` could read and then forge onto an unrelated failure to
  relabel it as `capability-denied`. Classification now happens entirely out
  of band via `netProviderDenial`, the tag is gone, and the worker no longer
  post-processes failure kinds. Cosmetic only (no boundary was crossed), but
  it removes the leak (docs/archive/PENTEST-REPORT-2026-08-23.md §9.3, P2-c).

## [0.4.0] - 2026-08-23

### Fixed

- **Hostile registry configuration (`@markii/react`)**: a registry entry
  whose `component` property is a throwing getter now degrades to the
  unknown-directive fallback instead of escaping `renderMark`, in every
  directive form and through alias resolution.

### Added

- **Script execution in the VS Code extension**: a `markii.runScripts`
  command with a play button on the preview title bar runs a note's Lua
  in a terminatable `worker_thread` behind an external wall-clock
  watchdog, feeding results into the already-shipped value-store render
  path. Network access is granted per host, keyed to a hash of the note's
  executable code so any code change re-prompts; the worker's net provider
  re-checks every redirect hop against the allowlist and bounds response
  reads to the fetch-size cap. A new `markii.resetScriptGrants` command
  clears a note's saved grant. Manual runs only; auto-run stays disabled.

### Security

- **Run-arc hardening (post-pentest)**: an independent red-team pass on the
  script-execution path produced fixes now landed with regression tests. The
  net provider resolves redirects hop by hop and re-checks each host before
  contacting it (no SSRF past a granted hostname); response bodies are
  bounded to the fetch-size cap as they stream and the worker runs under a
  capped heap (no flood or decompression-bomb OOM); a cache entry with an
  implausible (future or non-integer) timestamp is treated as a miss rather
  than served as permanently fresh; network denials are marked by identity,
  so a script can no longer relabel its own failure as `capability-denied`;
  a credential-bearing redirect target is denied and never contacted; stored
  grants are re-validated on read; a note naming more than ten hosts folds
  into one consolidated prompt; values sent to the preview carry only a
  failure's kind, never its text; `spawnRun` no longer rejects on an
  uncloneable payload; and the webview CSP nonce uses a CSPRNG. Hostname-only
  grant scope and the DNS-rebinding limitation are documented in
  `docs/security.md`.

### Changed

- **Cache self-heals (`@markii/lua`)**: `cache.get` treats a host-stored
  entry that cannot be used as a cache miss: it recomputes, overwrites the
  bad entry, and returns the fresh value, instead of denying the call
  until the host evicts the entry. This covers an entry that exceeds the
  marshal caps, cannot be JSON-encoded (cyclic or BigInt-bearing), is not
  a plain object, or carries a missing or non-finite `storedAtMs`. A
  denial is still raised only if the freshly computed value itself fails
  the write-side caps.

- **The format is named Markii** (rhymes with marquee), one name
  everywhere. This unifies the earlier split where titles said "Mark II"
  and prose said "Mark". A naming change only: package names (`@markii/*`),
  APIs (`renderMark`), the `.mk.md` extension, and the manifest's `mark`
  field are untouched.
- **Bundles are `.mkz`** (both the directory and zip forms), replacing the
  longer `.mkbundle`. Implementations, including `@markii/bundle`, keep
  recognizing `.mkbundle` as a legacy alias; everything generated uses
  `.mkz`.

## [0.3.1] - 2026-08-22

### Fixed

- **Fetch and cache results are plain Lua data (`@markii/lua`)**:
  `net.fetch_json`, `net.post`, and `net.patch` used to hand scripts a
  wasmoon proxy object (userdata) instead of the JSON-shaped Lua data the
  API documents, and `cache.get` did the same for a stored value on a
  cache hit. Three script-facing bugs followed (issue #6): returning a
  nested piece of a fetch result failed with a marshal error, `type()`,
  `#`, and `pairs` behaved inconsistently on results, and reading a JSON
  `null` field raised an error instead of yielding `nil`. Responses and
  cache hits are now decoded inside the sandbox into genuine Lua tables,
  with depth/node caps enforced host-side before decoding. The cache
  write path is also bounded now: a value being stored passes through the
  same capped, cycle-safe walk as a script's return value, so cyclic or
  oversized values fail cleanly instead of reaching storage, and a
  host-stored value that exceeds the caps is denied on the hit path the
  same way an oversized fetch response is. A JSON `null` decodes by one
  rule: absent as an object field, `false` in an array position (arrays
  stay dense). The change was adversarially verified; the review closed
  four hardening gaps before merge, including an array-marker spoof via
  remote JSON and call-time rebinding of the decoder's primitives.
  Behavior notes for consumers: the depth/node caps now bound fetched
  responses (previously only the byte cap effectively applied, since
  structured results could not be marshaled at all), and a cached value
  with mixed or sparse table keys now fails the marshal walk explicitly
  instead of being converted best-effort. New public API: the
  `CapabilityConfig.marshalLimits` field, plus `checkJsonWithinLimits`
  and `FETCH_DECODE_ERROR_TAG` exports.

### Added

- **Row alignment cascade (`@markii/react`)**: `align` on `:::row` now sets
  the text alignment inside every cell, instead of the (meaningless) block
  placement of the full-width row itself. An alignment wrapper written
  inside a cell still wins, so one cell can opt back out. Invalid values
  degrade silently, as everywhere in layout. New conformance fixture
  `27-row-align-left-wrapper`.
- **`:::left` layout wrapper (`@markii/react`, `@markii/stdlib`)**: a sixth
  wrapper, symmetric with `:::right`. It matches the default on its own and
  exists to override an inherited alignment, such as one cell of a
  `:::row{align=center}`. Contract added to `STANDARD_COMPONENTS`.

## [0.3.0] - 2026-08-18

### Added

- **Frontmatter tolerance (`@markii/core`)**: `parse` and `toHast` now run
  `remark-frontmatter`, so a leading `---` YAML block parses as a `yaml`
  node — exposed in the AST, dropped from the rendered output — instead of
  being read as a thematic break plus stray text. Everywhere else `---` keeps
  its ordinary CommonMark meaning: mid-document it is still a thematic break,
  an unclosed opening fence still degrades to ordinary markdown, and a
  frontmatter-shaped block that is not the document's first construct is not
  frontmatter. New exports `extractFrontmatter` (`{ raw, uses? }`, from
  source text or an already-parsed tree) and `extractFrontmatterUses` read
  the one format-defined key. The reader is hand-rolled and there is NO YAML
  dependency: it understands `uses: [a, b]` and the block-list form, quoting
  and whitespace tolerated, and returns `undefined` — never a throw, never a
  partial list — for anything else. New conformance fixtures
  `19-frontmatter`, `20-frontmatter-block-list`, `21-frontmatter-unclosed`,
  `22-frontmatter-not-at-start`, `23-thematic-break-mid-document`.
- **Registry aliases (`@markii/react`)**: a registry can now give an existing
  component a second name with preset attributes — `warn` standing for
  `callout{type=warning}` — via a new optional second argument to
  `createRegistry`, or the exported `REGISTRY_ALIASES` symbol on a
  hand-built registry. Resolution happens at lookup time, one hop only (an
  alias pointing at another alias lands on the unknown-directive fallback,
  never chains); a real registered component always beats an alias of the
  same name; author-written attributes always beat the alias's presets; a
  preset `width`/`align` goes through the same reserved-attribute
  interception as an author-written one; and an alias to an unregistered
  target renders the standard fallback for the TARGET name. `mergeRegistries`
  merges alias tables per name with the same last-wins semantics it gives
  components. Aliases are registry/app-level configuration and are never
  definable inside a note. Also exported: `registryAliases`,
  `resolveDirectiveAlias`, and the `RegistryAlias`/`RegistryAliases`/
  `ResolvedDirective` types.
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
- **`:::cell` grouping container (`@markii/react`, `@markii/stdlib`)**: a
  transparent container whose only job is making several blocks count as ONE
  cell of `:::row`. A row's cells are its direct block children, so two
  blocks are two cells; a `cell` around them makes them one. It also settles
  a case that was otherwise impossible: markdown merges two adjacent lists
  into a single list, so two task lists could never be two row cells — one
  `cell` around each separates them. Attribute-free, no look of its own
  (a plain `<div class="mk-cell">`, no border, background, padding, or outer
  margin — only a `doc.css` rule restoring rhythm between its own children),
  and inert outside a row. `@markii/react/components` exports `Cell`,
  `defaultRegistry` gains the `cell` name, and `@markii/stdlib`'s
  `STANDARD_COMPONENTS` gains its contract. No conformance fixture: at parse
  level `:::cell` is an ordinary container directive with no new AST shape.
- **Failure presentation parity (`@markii/react`)**: `MarkComponentProps`
  gains optional `dataError` and `dataFailureKind`, so `stat`/`progress`/
  `chart` present a failed `data=` binding exactly the way `:value[...]`
  already did — a `title` tooltip plus a modifier class hook
  (`mk-stat--tier-blocked`, `mk-chart--stale`, ...), never body text. Both
  props are supplied only for a directive that had a `data=` attribute, and
  `dataFailureKind` only for a genuine `error` resolution.

### Fixed

- **Directive form/kind mismatch no longer emits invalid HTML
  (`@markii/react`)**: a block component written as an inline directive —
  `:center[x]`, `:row[x]`, `:callout[x]` — used to render its block element
  inside the paragraph the directive was written in, i.e. a `<div>` inside a
  `<p>`, which every HTML parser restructures (the paragraph is closed and
  reopened), so the resulting DOM stopped matching the tree the renderer
  built. Such a directive now degrades to the unknown-directive fallback
  instead of rendering the component, and the fallback's ELEMENT follows the
  directive's form: an inline directive gets the `<span>`-based marker, a
  block directive the existing box. The label says which way round the
  mismatch is — "block component `center` written inline" — and the fallback
  carries an extra `mk-unknown--mismatch` class hook; the inner content is
  still shown, and nothing throws. Kind is read from the registry entry's own
  `inline` flag and nowhere else, so a component registered without one
  behaves exactly as before — degradation happens only where the mismatch is
  knowable — and a hostile entry whose `inline` getter throws fails permissive
  rather than escaping the render. The reverse direction (an inline component
  written as a leaf or container, `::kbd{}`, `:::badge ... :::`) deliberately
  stays permissive: phrasing content in block flow is parsed exactly as
  written and round-trips, so degrading it would cost the author their content
  for no correctness gain. `@markii/react/components` exports the new
  `DirectiveFallbackReason` type, and `UnknownDirectiveProps` gains an
  optional `reason`.
- **Never-throw against a hostile host store (`@markii/react`)**:
  `renderMark`/`renderMarkNode` only guarded parse and hast conversion, while
  a `data=`/`:value[...]` binding is resolved later, during React's render
  phase — so a host-supplied `ValueStore`/`VaultStore` whose `get()` threw,
  an entry with a throwing getter, or a stored value that was a revoked or
  trap-throwing `Proxy` hit during the dotted-path walk escaped the entry
  point's never-throw guarantee. The resolution layer (`resolveStorePath`/
  `resolveScopedPath`) now guards every host-store interaction; any such
  fault degrades to the ordinary `missing` resolution — the `{name}` marker
  for `:value[...]`, the quiet empty state for a data-bound component — with
  the thrown message carried in the existing `error`/tooltip channel and no
  `failureKind` invented. An off-contract `status` on a stored entry now
  degrades to `missing`, and a non-string `error`/`failureKind` is dropped
  rather than passed on to a `title=` attribute or a class lookup.
  `:value[...]` also survives a stored value whose `JSON.stringify` and
  `String()` both throw, rendering empty instead.
- **Never-throw in the reference data-bound components (`@markii/react`)**: a
  BARE (non-dotted) `data=` name performs no path walk, so the hostile value
  reached `stat`/`progress`/`chart` untouched and threw inside their own
  field reads (`Array.isArray`, property access, array iteration). All three
  now read a bound value through a shared `safeRead` guard: an unreadable
  binding degrades to the component's ordinary quiet empty state (`—`, a
  `0%` bar, `no data`), with the thrown message reaching only the tooltip and
  no `failureKind` invented. `chart` still plots a static `values=` series
  when the bound one is unreadable. A THIRD-PARTY registry component that
  throws while reading its own `data` prop is unchanged — that remains the
  embedding app's to guard; the standard set exemplifies the contract rather
  than relying on the exemption.

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
