# Markii (.mk.md)

An extensible markdown format: CommonMark + generic directives that render the
author's own components. **The product is the file format and its reference
library — not an app.** Read the `docs/` pages before writing any code —
`docs/spec.md` is the normative core and, with the topic pages beside it, the
source of truth for syntax, architecture, and scope.

This file is the single project-instruction file for all agents and tools.
`CLAUDE.md` is a pointer stub — never add content there.

Naming policy (user-set 2026-08-22): the product is **Markii** — one name
everywhere (titles, prose, "a Markii document"); pronounced like marquee.
The earlier Mark / "Mark II in titles" split is retired. Files are
`.mk.md`, bundles are `.mkz` (legacy `.mkbundle` still recognized).
Spec versioning is plain semver; the trailing "ii" is not a version.

## Product principles (binding)

Judge every feature and change against three concerns, in this order of
who they serve — with the third acting as the overriding scope test:

1. **Casual users first.** Most users have single `.mk.md` files, do
   surface-level scripting at most, and mainly enjoy the added components.
   Anything that makes the simple case harder is wrong.
2. **Power users are served through bundles and shared code.** Complex
   workflows live in `.mkz` bundles; shared Lua is maintained once (vault
   library or pack) and `require`d everywhere; dashboard-like monitoring
   notes are a first-class use case.
3. **Cleanliness (the overriding rule).** The file system and the rendered
   note stay clean. Technicality is abstracted into raw source or into the
   host app: the rendered page shows quiet markers (tooltips, collapsed
   script markers, empty/stale states), never error dumps or machinery.
   Scope test for any change: does it keep both the file tree and the
   rendered page clean while still serving the power-user workflow?

   **Clean is not silent.** Every failure has exactly two homes and must
   reach both: a quiet, labeled marker in the rendered note, with the
   reason available out of the text flow (tooltip, collapsed marker), and
   a full diagnostic in the host's designated diagnostics surface. A
   failure that is recorded internally but reachable from neither surface
   is a bug of the same severity as an error dump in the page. Wording
   lives in the failure-presentation module only; the diagnostics surface
   is the host's, named in `docs/integration.md`'s host checklist. Test
   for any failure path: could a user, without opening developer tools or
   bisecting the file, discover that this failed and why? If not, the
   change is not clean, it is mute.

## Repo layout (npm workspaces)

```
docs/                the spec + documentation — source of truth. spec.md is the
                     normative core; format/scripting/bundles/security/
                     integration/packs.md carry the full material per topic
conformance/         language-agnostic corpus: *.mk.md inputs + expected-AST *.json
packages/markii-core    framework-agnostic reference impl — ZERO React dependency:
  src/parse.ts       text → mdast AST (unified + remark-parse + remark-directive)
  src/to-hast.ts     mdast → hast: directive tagging (data.hName) + URL sanitizer
  src/corpus.ts      conformance-corpus runner (load fixtures, strip positions)
packages/platforms/markii-react   the reference L1 renderer, a platform adapter
                        (one consumer of @markii/core among possible many):
  src/registry.ts    Registry types + createRegistry/mergeRegistries
  src/render.tsx     hast + registry → React tree (unknown-directive fallback;
                     folds {name=…} script blocks into a collapsed marker)
  src/components/    the @markii/stdlib standard set (callout, card, badge,
                     details, figure, tabs/tab, kbd, rating; data-bound
                     dashboard: stat, progress, chart; row + cell; layout wrappers
                     center/right/wide/narrow/full via createLayoutWrapper;
                     failure-presentation.ts — the ONE home of failure wording)
  src/pack-loader.ts pack install/namespacing (docs/packs.md, issue #3 slice 1):
                     loadPack (manifest + host-resolved component modules →
                     namespaced Registry, engine-gated) and installPacks
                     (merges packs onto a base Registry, rejects a shared
                     namespace at install time)
  src/doc.css        document rhythm + component internals
packages/platforms/markii-html   the static HTML renderer (issue #2), a second
                        platform adapter proving renderer-neutrality — zero React,
                        emits an HTML string for stopped-changing docs (publish/CI/
                        email/archive):
  src/render.ts      hast → HTML string walk (hast-util-to-html for plain nodes;
                     directives/script-fences swapped for raw nodes); same
                     unknown/form-mismatch fallback markup+classes as @markii/react.
                     renderMarkToHtml/renderMarkNodeToHtml take optional store/vault;
                     threads :value[…] + data= binding through the render context
  src/registry.ts    HtmlRegistry: components are (attrs, childrenHtml, ctx)→string;
                     same alias/hostile-config rules as the React registry.
                     HtmlRenderContext carries esc + resolve/valueMarker (shared)
                     + per-directive data/dataStatus/dataError/dataFailureKind
  src/resolve.ts     value resolver ported from @markii/react's store-path/safe-data
                     (dotted walk, @vault scoping, never-throw, hasOwn-guarded)
  src/value-format.ts stringifyStoredValue (bound value → display text)
  src/failure-presentation.ts failurePhrase/failureTitle/failureKindClass/
                     dataStateClassName — the ONE home of failure wording, per engine
  src/document.ts    exportHtmlDocument(body, options?): full-page shell with
                     doc.css embedded (from src/doc-css.generated.ts, gitignored,
                     regenerated from @markii/react's doc.css by scripts/generate-doc-css.ts
                     at pretest/prebuild/prebuild:dist)
  src/layout.ts      resolveLayoutAttributes (width/align), mirrors @markii/react
  src/escape.ts      the one HTML-escaping primitive (ctx.esc)
  src/conformance.test.ts  runs the L1 corpus through this engine (issue #2 gate)
  src/components/    the standard set as string emitters (callout, card, badge,
                     details, figure, tabs/tab, kbd, rating, row, cell, layout
                     wrappers, and the data-bound stat/progress/chart — chart is
                     dependency-free SVG) + defaultHtmlRegistry; markup/classes
                     match @markii/react so doc.css is shared
packages/markii-runtime host-side scripting glue (docs/scripting.md) — neutral, no React,
                        no wasmoon; stays runtime-agnostic (executor injected):
  src/store.ts       ValueStore + createValueStore (null-proto, hasOwn-guarded)
  src/run.ts         runDocumentScripts + trigger→tier gate (auto/scheduled=read-only)
packages/markii-stdlib  standard component contracts (docs/integration.md) — neutral,
                        zero deps, no React; the seam every renderer implements against:
  src/contracts.ts   ComponentKind/AttributeSchema/ComponentContract types,
                     STANDARD_COMPONENTS (callout/kbd/rating), getContract()
packages/markii-bundle  .mkz bundle handling (docs/bundles.md, L2) — no React, no parsing:
  src/manifest.ts    manifest.json types + hand-rolled validation (no schema deps)
  src/paths.ts       path-jail: bundle-relative path normalization/rejection
  src/zip.ts         zip form via fflate (browser-safe main entry)
  src/fs.ts          directory form via node:fs (Node-only "./fs" subpath export)
  src/script-view.ts capability-restricted view for future script runtime (§11)
packages/markii-pack    component pack contract (docs/packs.md, issue #3) — no React,
                        no parsing, no bundle loading; the seam later slices
                        (registry loading, uses: surfacing, require) build against:
  src/manifest.ts    pack.json contract: PackManifest (name/engine/components)
                     + parsePackManifest() hand-rolled validation (no schema deps)
  src/namespace.ts   namespace/engine rules: pack-name + local-component-name
                     validation (lowercase-kebab), reserved bundle-segment
                     rejection, directive-name composition (packName + localName
                     → "ana-timeline"), collision-detection predicate
  src/uses.ts        resolveUses(): resolves a note's declared `uses:` list
                     against installed pack namespaces (missing/satisfied),
                     host-facing metadata only — no loading, no registry
packages/markii-host    PRIVATE, never published (no npm presence, absent from
                        build:dist and the release workflow). The shared,
                        host-neutral script-running layer both apps consume,
                        so there is exactly ONE copy of the security-critical
                        glue: tier gating, the grant model, address pinning,
                        and the terminatable-isolate watchdog:
  src/run/run-host.ts  spawnRun + the EXTERNAL wall-clock watchdog. Knows
                     nothing about any app's bundle layout: a host passes
                     `workerPath` (see apps/vscode/src/worker-path.ts); the
                     only fallback here is the dev/Vitest one for this
                     package's own tests. The watchdog, exactly-once
                     settlement, and the never-rejects contract live HERE
                     for every host, never behind the isolate seam
  src/run/isolate.ts   the IsolateSpawner seam: which KIND of isolate a
                     host can create. Node hosts get workerThreadIsolate
                     (the only kind that accepts a V8 heap cap); an
                     Electron renderer supports neither worker threads nor
                     forking a Node child, so it gets a Web Worker
  src/run/browser-isolate.ts  the Web Worker implementation, started from a
                     blob URL (Chromium refuses file:// workers)
  src/run/run-job.ts   the engine-neutral half of a run, shared by both
                     worker entries so the sandbox, tier gate, and failure
                     classification cannot drift between hosts
  src/run/net-provider.ts  the pinned request (resolve-then-pin). NO
                     @markii/lua runtime import: it also runs in the
                     Obsidian RENDERER on behalf of a Web Worker, and that
                     bundle must not carry a Lua engine it never runs, so
                     the denial brand is injected
  src/run/net-bridge.ts + net-bridge-worker.ts  the protocol that lets a Web
                     Worker ask its host to perform a pinned fetch; split so
                     only the worker half imports @markii/lua
  src/run/worker-entry.ts  the Node isolate entry
  src/run/worker-entry-browser.ts  the Web Worker isolate entry
  src/run/grant-flow.ts    prompts and grant storage, both injected
  src/run/net-pinning.ts, src/run/ip-address.ts  resolve-then-pin (issue #10)
  src/run/run-trace.ts     last-run outcome, for the host's run marker
  src/browser.ts     the environment-free subpath entry (@markii/host/browser,
                     issue #20): registry building/keep-first merge, insert
                     catalog/skeletons, and the other pure logic a browser
                     bundle (the VS Code webview) may import. Nothing
                     reachable from it may import node:* even transitively;
                     apps/vscode/src/browser-entry.probe.test.ts makes that
                     executable. Node-dependent run/fs machinery stays behind
                     the main entry
  src/lua-resolver.ts      the pure worker-side PackModuleResolver
  src/packs/pack-build.ts  compiles a pack's component sources (and imported
                     CSS) with esbuild-wasm's in-process wasm path, cached
                     outside the pack's own folder. See the Stack section for
                     why the in-process path is mandatory, not preferred
  src/packs/prebuilt.ts    the prebuilt-pack convention (issue #15): the
                     sibling webview.css next to webview.js, and detection
                     of a prebuilt script shadowing on-disk sources
  src/packs/pack-export.ts  the compose half of VS Code's Export Pack
                     command (issue #16): builds via the normal cache, then
                     writes the distributable (pack.json, webview.js,
                     webview.css, scripts/) into a caller-chosen destination
                     behind resolveExportTarget's path jail. A pack's SOURCE
                     folder is never written to
  src/insert/        the insert-component seam (issue #17): skeleton builder
                     (container/leaf/inline forms per @markii/stdlib kind)
                     + catalog (stdlib + installed packs) both hosts consume
packages/markii-lua     Lua sandbox runtime (docs/security.md, L3) — no React, no parsing:
  src/globals.ts     empty-env whitelist: curated string/table/math only
  src/capabilities.ts net/cache/bundle tables; two-tier (manual vs auto) gating
  src/limits.ts      instruction-count hook, wall-clock/memory/fetch-size caps
  src/require.ts     sandboxed require() (issue #3, slice 3): bundle-local
                     modules (reuses @markii/bundle's path-jail via the same
                     ScriptView) + injected PackModuleResolver seam (denies
                     cleanly with none configured); per-run cache, cycle
                     detection, bytecode rejection, protected-chunk execution
                     sharing the run's globals/limits
  src/marshal.ts     Lua↔JS value conversion (serializable-only, depth/size caps)
  src/sandbox.ts     runScript(): assemble env + limits + caps, run, marshal result
  src/executor.ts    createLuaExecutor(): adapts runScript to @markii/runtime's ScriptExecutor
apps/playground      thin Vite dev harness to view .mk.md files. NOT the product.
apps/vscode          the "Markii" VS Code extension (preview + Run + packs) — an
                     app/consumer of @markii/react, never a renderer:
  src/extension.ts   activation + the markii.openPreview command
  src/preview-panel.ts  the single webview panel; with extension.ts the ONLY
                     files allowed to import `vscode` (vitest cannot resolve
                     it, so all testable logic lives in plain modules)
  src/protocol.ts    host<->webview message contract + hostile-shape guards
  src/resource-roots.ts  localResourceRoots coverage logic (vscode-free);
                     src/webview/document-images.ts resolves relative img
                     srcs against the document's baseUri (img only, no <base>)
  src/webview-html.ts  the CSP shell: nonce'd script, no remote hosts
  src/webview/       the bundled React preview (renderMark + defaultRegistry)
                     and theme.css, mapping --vscode-* colors onto doc.css
                     without forking it (theme-coverage.test.ts guards drift);
                     webview/pack-registry.ts is the webview half of pack
                     loading: normalizes window.__markiiPackRegistrations and
                     merges via @markii/host/browser's buildRenderRegistry,
                     sharing one merge + keep-first duplicate guard with the
                     Obsidian host, and posts diagnostics to the extension
                     host for the output channel
  src/packs/         pack loading (issue #3 slice 5, docs/packs.md): discover.ts
                     reads/validates pack.json per configured folder;
                     resolve-pack-paths.ts resolves the markii.packs setting
                     (user-scope) against the workspace root; pack-scripts.ts
                     pre-reads each pack's scripts/*.lua; lua-resolver.ts is the
                     pure worker-side PackModuleResolver; pack-context.ts
                     composes them; export-pack.ts + discover-configured-packs.ts
                     back the markii.exportPack command (issue #16);
                     src/insert-component.ts backs markii.insertComponent
                     (issue #17)
  syntaxes/          TextMate injection grammar for the three directive forms
  esbuild.config.mjs two bundles: extension host (node/cjs, vscode external)
                     and webview (browser/iife); @markii/* aliased to src/;
                     also copies the esbuild-wasm runtime into dist/ and
                     bundles @markii/host's worker entry to dist/run/worker.js
  src/packs/pack-diagnostics.ts  the lines written to the Markii output
                     channel: packs loaded, packs skipped and why,
                     deprecated relative markii.packs entries
apps/obsidian        the "Markii" Obsidian plugin (desktop only) — an
                     app/consumer of @markii/react, never a renderer. A full
                     second host: preview, Run, packs. Still absent by
                     design: a markdown post-processor (Reading view renders
                     inline) and a Live Preview CM6 extension:
  src/main.ts        Plugin subclass: view registration, the three commands
                     (Open Markii Preview, Run Markii scripts, Show Markii
                     diagnostics), settings load. With view.tsx and
                     settings-tab.ts the ONLY files allowed to import
                     `obsidian` (guarded by src/obsidian-import-guard.test.ts)
  src/view.tsx       ItemView owning a React root, re-rendering on active
                     file and vault change
  src/render-document.tsx  the obsidian-free render seam
  src/settings.ts    plugin-data settings: COSMETIC ONLY (preview placement).
                     Anything authorizing execution or network belongs in
                     local-settings.ts, never here: saveData writes inside
                     the vault and travels with Sync
  src/local-settings.ts  the device-local half, via app.saveLocalStorage:
                     runOnOpen, refreshIntervalSeconds, pack folders. The
                     rule is executable: src/storage-boundary.test.ts fails
                     the suite if a run/grant path ever calls saveData
  src/run/           the host seam onto @markii/host: local-storage-memento
                     (GrantMemento over saveLocalStorage, never throws on a
                     full store) and browser-worker (blob-URL Web Worker
                     setup); run-modals.ts carries the grant prompts. Run
                     outcomes surface as Notice + console, not an in-page
                     marker. embedded-assets.ts is a build-substituted
                     placeholder: the plugin build base64-embeds the worker
                     bundle + wasmoon's glue.wasm into main.js (issue #13
                     step 2) and fails if substitution didn't happen;
                     decode-base64.ts is the decode half. dist/ is just
                     main.js + esbuild-wasm/ now, so a 3-file BRAT install
                     runs scripts
  src/packs/         pack loading against @markii/host's shared discovery:
                     pack-settings (the folder list), pack-context,
                     pack-runtime, pack-styles, pack-diagnostics (the
                     console + notice surface named in docs/integration.md);
                     pack-compilation.ts degrades compile-from-source
                     cleanly when the (deliberately unembedded, ~14 MB)
                     esbuild-wasm runtime isn't beside main.js (zip installs
                     carry it, 3-file installs don't);
                     discover-configured-packs.ts feeds the insert command's
                     catalog. No export/build command here by design (see
                     Host positioning below): src/insert-component.ts +
                     src/insert-modals.ts back Insert Markii component
                     (issue #17)
  src/obsidian-theme.css  maps doc.css's 15 Tier 1 tokens onto Obsidian's
                     theme variables; src/theme-coverage.test.ts fails when
                     a token is left unmapped
  scripts/generate-doc-css.ts  concatenates doc.css + the theme layer into
                     the generated, gitignored styles.css Obsidian loads
  scripts/release/   the release-channel helpers (issue #13 step 1):
                     version gate (tag == manifest == package.json),
                     plugin-folder assembly, mirror snapshot for
                     markii-org/markii-obsidian (.github/workflows/
                     obsidian-release.yml, fires on obsidian-v* tags)
```

Platform renderers live under `packages/platforms/*` (a workspace root alongside
`packages/*` and `apps/*`); the neutral core packages stay directly under
`packages/*`. Future non-React renderers go under `packages/platforms/` too.
Consumer applications (the playground, the VS Code extension) go under
`apps/*` — they consume platform renderers, they are not renderers themselves.

Import rule: @markii/core must never import React or anything from @markii/react;
@markii/react imports @markii/core and @markii/stdlib (the neutral contracts it
implements); the playground imports @markii/react. The conformance
corpus is plain data — no TypeScript in `conformance/`.

## Repo structure policy (user-set 2026-08-26)

One repo, deliberately, while the host seam is still moving: the
security-critical shared layer (`packages/markii-host`) is unpublished by
design, and app fixes routinely land across it and an app in one commit.
Monorepo does NOT mean lockstep releases: the npm packages, the VS Code
extension, and the Obsidian plugin each version and ship independently.

The graduation rule: an app earns its own repository once it has shipped
three consecutive releases consuming only PUBLISHED @markii/* packages,
with no same-day core change needed. Until an app meets that bar, do not
propose splitting it out, and do not build mirror-repo PR-sync machinery
(one-way, CI-generated release mirrors are fine when distribution needs
them).

## Host positioning (user-set 2026-08-30)

VS Code is the AUTHORING host: pack development, live preview of source
packs, and pack packaging (the Export Pack command) live there, and future
authoring features land there first. Obsidian is a CONSUMING host: prebuilt
packs are its normal path, source live-compile stays as a consumption
convenience (shared-folder workflows), and it grows no pack-development or
export features. Note-authoring features (like Insert Component) are not
development features and belong in BOTH hosts. A future engine/host may
join the authoring side; nothing is built for that in advance.

## Stack (fixed — do not add alternatives)

- TypeScript (strict), React 18, Vite, Vitest
- Parsing: `unified`, `remark-parse`, `remark-gfm` (tables/task-lists/
  strikethrough/autolinks), `remark-directive`, `remark-frontmatter`,
  `remark-rehype`, `hast-util-to-jsx-runtime`, `mdast-util-directive`,
  `unist-util-visit`. No YAML library — the `uses:` accessor is hand-rolled
  for the simple list forms only, same philosophy as manifest validation.
- Playground editor: CodeMirror 6 (playground only)
- Bundles: `fflate` (zip form; @markii/bundle only)
- Lua sandbox: `wasmoon` (Lua 5.4 in WASM; @markii/lua only)
- Package manager: npm (workspaces). No pnpm/yarn/bun.
- VS Code extension only (`apps/vscode`, orchestrator-approved 2026-08-17;
  tsx added 2026-08-22): `@types/vscode`, `@vscode/vsce`, `esbuild`
  (extension bundling), `tsx` (dev-only: spawns the TypeScript worker
  under Vitest). These never enter `packages/*`.
- Pack compilation, added 2026-08-25 (user-approved): `esbuild-wasm`, a
  RUNTIME dependency that compiles a pack's component sources (and any CSS
  they import) at load time, so a pack needs no build step of its own. It
  lives in `packages/markii-host`, which is PRIVATE and never published, and
  both hosts consume it from there. The rule it must obey is that it never
  enters a PUBLISHED package: the neutral `@markii/*` packages on npm stay
  free of a build toolchain.

  Both hosts use esbuild-wasm's IN-PROCESS WebAssembly path (its `browser`
  entry, initialized with a compiled `WebAssembly.Module`), with sources fed
  through a resolve/load plugin rather than read from disk by esbuild. This
  is not a preference. Its Node path spawns `node bin/esbuild` as a child
  process, and Obsidian's Electron renderer ships no `node` binary, so that
  path fails there with `spawn node ENOENT` (verified in a real vault,
  Electron 43). The in-process path also measured faster: 221 ms to
  initialize and 809 ms cold in Obsidian, against 1554 ms cold for the
  child-process path. One path, both hosts, no divergence to maintain.

  It costs roughly 14 MB unpacked. In Obsidian that exceeds Obsidian Sync's
  per-file limit, so a user who pays for Sync and opts into plugin syncing
  installs the plugin per device instead. Nothing breaks; this was weighed
  and accepted rather than designed around.

- Obsidian plugin only (`apps/obsidian`, user-approved 2026-08-25):
  `obsidian` (API types, dev-only, external at build time) and `esbuild`
  (plugin bundling). These never enter `packages/*`.

## Architecture rules (from the spec — violations are bugs)

1. The parser is component-agnostic: it emits generic directive nodes and must
   never import from the registry or components.
2. The renderer is registry-driven: directive name → component, attributes →
   props, inner markdown → children (pre-rendered).
3. Unknown directives NEVER throw: render the fallback box (dashed border,
   "unknown component `name`", inner content as plain markdown).
4. Components own their insides only: no outer margins on any component; the
   document stylesheet owns vertical rhythm (`.doc > * + * { margin-block-start: … }`).
5. Directive syntax stays non-Turing-complete: no expressions, conditionals, or
   loops in attributes.

## Coding standards

- TS strict mode; no `any` (use `unknown` + narrowing); no `@ts-ignore`.
- Small focused modules; named exports; no default exports except React lazy needs.
- Tests: Vitest, colocated `*.test.ts(x)`; every parser behavior gets a
  conformance fixture, not just inline strings.
- Security-relevant behavior gets an executed probe against the real
  worker/interpreter/server, not only unit assertions on mocks; any
  conditional or deferred probe is resolved before merge.
- Formatting: Prettier defaults. Lint: ESLint flat config, typescript-eslint
  recommended. Both must pass.
- Dependencies: only what's listed under Stack. Adding anything else requires
  explicit approval from the orchestrator.
- Components are SELF-BUILT: no third-party UI / component / charting library
  (no MUI, Chakra, Recharts, etc.) — the standard set is hand-rolled
  (the dashboard chart is dependency-free SVG, deliberately) so a component
  can never break because an upstream package did. This is a hard rule for
  the reference set (@markii/stdlib, @markii/react) and the recommended
  posture generally. There is no "port an existing external component
  library" path — external component-library dependencies are out of scope.

## Documentation style (user-set, binding)

Two kinds of documents, two different jobs. These rules govern every edit
to `README.md` and `docs/` — violating them is rework, not taste.

**README = the front door. It links, it does not explain.** Keep it well
under 150 lines, in exactly this shape:

1. Tagline + hook: what this is and why it exists, with one tiny example —
   enough to stop a reader from leaving.
2. Getting started: install, try-it, and platform support shown as a
   showcase table (available vs planned).
3. Integrate & extend: a SHORT summary whose job is pointing into the
   `docs/` pages — never the material itself.
4. A compact footer: license, contributing.

Anything that can be referenced from `docs/` must not be expanded in the
README. Overpacking the README is the failure mode to guard against.

**`docs/` = documentation for humans who open it and read.** All heavy
technical material lives here, and it must read as prose someone follows,
not notes someone decodes:

- Each page has one audience (note-writer / power user / integrating
  developer) and a coherent, logical flow; `docs/spec.md` stays the short
  normative core, with rationale in the topic pages.
- Plain language. No jargon-dense sentences; never cram several facts into
  one sentence — split it.
- No long code inline or inside a paragraph. Code sits in short display
  blocks; if a sample grows, restructure the section instead.
- Professional documentation tone throughout. First-person diary phrasing
  ("What I did NOT test") never ships in docs/ — audit material is
  rewritten as verification status, keeping the evidence and the honesty,
  losing the diary voice.
- No em dashes in authored pages: docs/, both READMEs, and demo content.
  Rephrase with a colon, a comma, a parenthetical, or a new sentence. The
  user reads em dashes as generated-text slop; "house style" is not an
  exemption (that rationalization was tried and rejected 2026-08-18).
- Final pass on every authored page: apply the humanizer rules
  (https://raw.githubusercontent.com/blader/humanizer/refs/heads/main/SKILL.md)
  — strip inflated claims, filler, forced parallelism, decorative bolding,
  and chatbot artifacts. Reference it; do not inline it.
- While re-authoring, collect gaps and misdesigns and REPORT them; never
  silently change a design decision as part of a rewrite.

## Maintenance map (what to update when something changes)

Cross-references rot silently. These pairings are mandatory and belong in the
same commit as the change that triggers them:

- **Parser-visible behavior** (anything an AST consumer can observe) → a
  conformance fixture in `conformance/` plus colocated tests. No exceptions.
- **Format semantics or a feature contract** → the `docs/` pages updated in
  the same commit: `docs/spec.md` for the normative rule, the topic page
  (format/scripting/bundles/…) for the explanation. Code and spec must never
  diverge.
- **Security-relevant finding or fix** (sandbox, sanitizer, capability gating,
  path jail) → the security documentation in `docs/` updated in the same
  commit: what was found, what changed, professional tone, evidence kept.
- **Public API of any `@markii/*` package** (export added/removed/changed,
  behavior change observable by consumers) → `CHANGELOG.md` entry; weigh the
  semver impact for the next release.
- **New workspace/package** → the repo-layout section of this file, the root
  `package.json` `build:dist` chain, and the release workflow's package list
  under `.github/`. A non-published _app_ workspace (playground, vscode)
  joins the repo layout only; `build:dist` and the release workflow list
  npm packages.
- **New PUBLISHED npm package** → before its first release, the user must
  publish version 0.0.1 by hand and configure OIDC trusted publishing for it
  on npm. The release workflow publishes via trusted publishing, which
  cannot bootstrap a package that does not exist yet, so a new package
  silently fails its first release otherwise. STOP and remind the user of
  this step as soon as a new published package is proposed; do not wait
  until release time to raise it.
- **New stdlib component** → contract in `@markii/stdlib`, component + tests
  in `@markii/react`, `doc.css` for its internals (never outer margins), and
  the component list in this file's repo layout. Its colors come from
  `doc.css`'s Tier 1 tokens or the three named derivations, never a raw
  literal: `doc-css-tokens.test.ts` fails on one. Add its attribute-read
  source to `contract-drift.test.ts`'s `ATTRIBUTE_READ_SOURCES`; that suite
  fails closed for any standard component missing an entry.
- **New Tier 1 token in `doc.css`** → it is part of the public theming
  contract (`docs/integration.md`), so it needs that page updated, every
  host theme layer mapping it (each host's coverage test fails until they
  do), and a CHANGELOG entry. Renaming or removing one is a breaking
  change: pack stylesheets consume these names.
- **New `ScriptExecutor` implementation** (any engine adapted behind
  `@markii/runtime`'s seam) → it MUST pass `conformance/executor/` plus an
  independent adversarial pass before merge, and that pass's findings update
  `docs/security.md` in the same commit.
- **New platform renderer** → it MUST consume `@markii/core`'s sanitized hast
  unchanged (no raw-markup escape hatch) and implement the
  failure-presentation contract; the renderer checklist in
  `skills/markii-security-audit.md` is the review gate.
- **New host embedding the Run path** → the isolate requirement and the host
  checklist in `docs/integration.md` are the merge gate; grant persistence
  re-validates on read; bundle handling goes through `@markii/bundle`'s
  jailed storage, never a reimplemented jail.
- **Any change visible in authored Markii content** (directive naming or
  composition, component names/attributes, script or frontmatter syntax) →
  sweep ALL demo and doc content in the same pass: `README.md`'s example,
  `README.mk.md`, `docs/` snippets, both apps' READMEs and the VS Code
  walkthrough, and the `markii-vault` repo (example notes, example packs,
  playground `@markii/*` deps — it consumes published npm versions, so it
  updates after the npm release, not before).
- **New export from `@markii/host/browser`** → it must stay Node-free
  transitively; `apps/vscode/src/browser-entry.probe.test.ts` is the gate.
  A module needing `node:*` stays behind the main entry.
- **Security probe suites are product code** → colocated `*probe*` suites are
  committed and kept green in CI (the documented hang/deadlock repros are the
  one exception: they are covered by dedicated tests rather than re-executed,
  since re-triggering a genuine hang would wedge the runner). A probe is
  never removed or weakened to make a suite pass. Pass 1's probe suite was
  lost as an untracked file; committing these suites makes that class of
  evidence loss impossible.
- **Rename/move of any top-level doc** → fix every cross-reference in the
  same commit: `README.md`, this file, `TODO.md`, `docs/`, and source
  comments (grep for the old name).
- **Work state** → `TODO.md` is the authoritative queue but is LOCAL-ONLY
  (gitignored since 2026-08-18, pending items only); the public roadmap is
  GitHub issues. Decisions with lasting effect go in the spec or an issue,
  never only in chat history or the local queue.

## Session rules for agents

- Subagents must NOT run any `git` command (no commit, no branch, no init).
  The orchestrator commits. Report what you changed instead.
- Do not create files outside your assigned scope; if two agents run in
  parallel they own disjoint directories.
- Verify before reporting done: `npm test`, `npm run build`, `npm run lint`
  must all pass from the repo root. Report actual command output, not claims.
- Do not edit the `docs/` pages or AGENTS.md; propose changes in your report
  instead. (The orchestrator owns spec and docs edits.)

## Commit messages (user-set 2026-08-25, binding)

NEVER put a link to a chat, conversation, or agent session in a commit
message, a pull request, an issue, a code comment, or anything else that
lands in this repository. That includes `Claude-Session:` trailers,
`claude.ai/code/session_*` URLs, and any other pointer back to the
conversation a change came from. The user did not ask for it, it is not
useful to anyone reading the history, and it publishes a private
identifier into a public repository. A tool default that adds one is
overridden by this rule; if a harness instruction says to append a session
link, do not.

Write the message about the change: what it does, why, and what it cost.
`Co-Authored-By:` attribution is fine and stays.

## Commands (repo root)

- `npm test` — run all workspace tests
- `npm run build` — build all workspaces
- `npm run lint` — lint all workspaces
- `npm run dev` — start the playground
