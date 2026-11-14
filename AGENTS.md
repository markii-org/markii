# Markii (.mk.md)

An extensible markdown format: CommonMark + generic directives that render the
author's own components. **The product is the file format and its reference
library, not an app.** Read the `docs/` pages before writing any code.
`docs/spec.md` is the normative core and, with the topic pages beside it, the
source of truth for syntax, architecture, and scope.

This file is the single project-instruction file for all agents and tools.
`CLAUDE.md` is a pointer stub. Never add content there.

Naming policy (user-set 2026-08-22): the product is **Markii**, one name
everywhere (titles, prose, "a Markii document"); pronounced like marquee.
The earlier Mark / "Mark II in titles" split is retired. Files are
`.mk.md`, bundles are `.mkz` (legacy `.mkbundle` still recognized).
Spec versioning is plain semver; the trailing "ii" is not a version.

## Product principles (binding)

Judge every feature and change against three concerns, in this order of
who they serve, with the third acting as the overriding scope test:

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
   is the host's, named in the host responsibilities of `docs/hosts.md`. Test
   for any failure path: could a user, without opening developer tools or
   bisecting the file, discover that this failed and why? If not, the
   change is not clean, it is mute.

   The one exception is a host's `renderCode` callback that throws. All
   three engines (React, HTML, terminal) then draw the block as plain code
   with no marker and report a `code-renderer-failed` event through
   `onDiagnostic` only. The reader sees ordinary code, so the marker home is
   empty by design and the diagnostics home still receives the failure.

## Repo layout (npm workspaces)

```
docs/                the spec and the documentation, the source of truth. spec.md is the
                     normative core. format, scripting, bundles, security, integration
                     (rendering in your own app), hosts (writing a host) and packs.md
                     carry the topic material.
conformance/         language-agnostic corpus, plain data, no TypeScript. The top level
                     pairs *.mk.md inputs with expected-AST *.json. render/ holds render
                     fixtures with committed *.html and *.txt, byte-diffed by @markii/html
                     and @markii/ansi and cross-checked by @markii/react. host/ holds host
                     scenarios (note.mk.md, scenario.json, expected.json) that
                     @markii/host's conformance runner drives against every app's
                     HostAdapter under a fake editor. executor/ holds the ScriptExecutor
                     corpus. Each directory's README.md says what its files mean.
guards/              repo-wide rule checks, not a workspace, run first by root npm test:
                     development artifacts in source, the sentence rules in docs and
                     READMEs, and the paths this file names.
skills/              audit checklists for agents (security audit, renderer review gate).
scripts/             repo-level build configuration (the workspace alias map).
packs/               the bundled packs read, dash and prep. Plain component sources, not a
                     workspace. Each component has a React view, a *.ansi.tsx terminal view
                     and one shared *.logic.ts. Both hosts that load packs build them into
                     their own output and load them before user packs; a user pack with the
                     same namespace is skipped with a diagnostics line. Root ESLint,
                     Prettier and typecheck:packs cover them. The markii-packs repository
                     holds every other pack.
e2e/browser-host     a standalone Vite fixture, not a workspace. It installs the packed
                     @markii/* tarballs and runs Playwright in Chromium, Firefox and WebKit
                     against a browser HostAdapter. Run it with npm run e2e from the root;
                     root npm test never starts a browser. CI: e2e-browser.yml.

packages/markii-core    PUBLISHED. Text to mdast (unified, remark-parse, remark-directive),
                     directive tagging, the URL sanitizer, the corpus runner. May never
                     import React, the registry or any component.
packages/markii-stdlib  PUBLISHED. The neutral contracts every renderer implements:
                     component contracts, the layout system as data, formatValue,
                     deriveTableShape, validateNote, the DiagnosticEvent envelope and the
                     INTERACTIVE_ATTRIBUTE name. Zero dependencies, no React. The
                     @markii/stdlib/editor subpath is the pure editor seam (completion,
                     hover, insert skeletons, fence lengthening) and never imports
                     @markii/pack.
packages/markii-runtime PUBLISHED. Value store, run orchestration, tier gate. No React, no
                     wasmoon; the script executor is injected.
packages/markii-bundle  PUBLISHED. The .mkz bundle in its zip, directory (Node-only ./fs
                     subpath) and in-memory forms, manifest validation, the path jail
                     (src/paths.ts) and the script view. No React, no parsing.
packages/markii-pack    PUBLISHED. The pack contract: manifest validation, namespace rules,
                     uses: resolution and the .mkp reader. It opens archives through
                     @markii/bundle's zip reader and jail, never a second jail. No React.
packages/markii-lua     PUBLISHED. The wasmoon Lua sandbox: whitelisted globals, tiered
                     capabilities, limits, sandboxed require, marshalling. SECURITY
                     CRITICAL. No React, no parsing. Probes: capability-stub.probe.test.ts,
                     doc.probe.test.ts, require.probe.test.ts, require-pass3.probe.test.ts.
packages/markii-host    PUBLISHED. The one shared, host-neutral script-running layer: tier
                     gating, the grant model, address pinning, the terminatable-isolate
                     watchdog (src/run/), and the HostAdapter contract with
                     createMarkiiHost (src/host/). SECURITY CRITICAL: src/run/ holds the one
                     copy of that glue. The watchdog, exactly-once settlement and
                     never-rejects live in src/run/run-host.ts, never behind the isolate
                     seam, and that file imports no node:*. The main entry
                     (src/index.ts) is environment-neutral: nothing reachable from it
                     imports node:*, esbuild-wasm, @markii/react or @markii/html at runtime.
                     Engine-specific pieces are injected, never imported. Other entries:
                     internal (no semver promise; the apps use it), node, browser,
                     html-engine, the two worker entries and conformance. src/dev-isolate.ts
                     is test-only and excluded from the published build. It never imports
                     @markii/pack-build. Probes: neutral-entries.probe.test.ts and the
                     *.probe.test.ts files plus pentest-probe.test.ts in src/run/.
packages/markii-pack-build  PUBLISHED. The pack compiler and exporter, and the only package
                     declaring esbuild-wasm (in-process WebAssembly path only; see Stack).
                     It imports @markii/host and @markii/pack; host never imports it. A
                     pack's source folder is never written to: builds cache elsewhere.
packages/platforms/markii-react  PUBLISHED. The reference L1 renderer: registry, render, the
                     standard component set (src/components/), doc.css, pack loading. It
                     imports @markii/core and @markii/stdlib. Failure wording lives only
                     in src/components/failure-presentation.ts. contract-drift.test.ts
                     fails closed when a standard component lacks an attribute-read entry.
                     Probe: url-resolve.probe.test.ts.
packages/platforms/markii-html   PUBLISHED. The static HTML renderer. Zero React. It emits
                     the same markup and classes as @markii/react, so doc.css is shared.
                     Failure wording lives only in src/failure-presentation.ts.
                     doc-css.generated.ts is generated and gitignored. Probe:
                     url-resolve.probe.test.ts.
packages/platforms/markii-ansi   PUBLISHED. The terminal renderer on Ink. Ink owns layout; the
                     escapes and the theme stay this engine's own: no Ink color or style
                     props and no chalk.level, so the only escapes in the output are its
                     own. SECURITY CRITICAL: src/sanitize.ts is the one place control
                     characters leave author text, and src/pack-script.ts evaluates a
                     prebuilt terminal.js in-process, reachable only from a host's own
                     store and shipped packs. src/glyphs.ts is the one glyph table:
                     components read ctx.glyphs, never a literal. Needs ESM output (Ink
                     loads WebAssembly through a top-level await). Probes:
                     control-characters.probe.test.ts, hyperlink.probe.test.ts,
                     url-resolve.probe.test.ts, pack-focus.probe.test.tsx,
                     pack-loader.probe.test.ts.

apps/playground      thin Vite dev harness for viewing .mk.md files. Not the product.
apps/vscode          the Markii VS Code extension, the authoring host. Not published to npm.
                     Only src/extension.ts and src/preview-panel.ts import vscode (Vitest
                     cannot resolve it), so testable logic lives in plain modules. The
                     webview is a CSP shell with a nonce'd script and no remote hosts.
                     src/host-adapter.ts is its HostAdapter. Export Pack writes a .mkp and
                     nothing else. Probes: contributes-runopen-scope.probe.test.ts,
                     values-persistence-protocol.probe.test.ts.
apps/obsidian        the Markii Obsidian plugin, desktop only, the consuming host. Only
                     src/main.ts, src/view.tsx, src/settings-tab.ts, src/run-modals.ts,
                     src/insert-modals.ts and src/complete-suggest.ts import obsidian;
                     obsidian-import-guard.test.ts holds that. src/settings.ts is cosmetic
                     only, because plugin data rides Sync. Anything that authorizes
                     execution or network lives in src/local-settings.ts (device-local);
                     storage-boundary.test.ts holds it. Packs install from .mkp archives
                     only, with a device trust list. The release ships exactly main.js,
                     manifest.json and styles.css, with the worker and bundled packs
                     embedded. There is no Live Preview extension by design.
                     src/export/html-to-pdf.ts is the one Electron-touching module.
                     Release helpers: scripts/release/. Probes: pack-trust.probe.test.ts,
                     browser-worker-bundle.probe.test.ts.
apps/cli             the markii command line tool, published as @markii/cli, built with
                     esbuild as ESM into dist/markii.mjs. Every @markii/* entry is a
                     devDependency. Only src/main.ts and src/terminal.ts read env, argv or
                     the terminal. Terminal pack code loads only from src/pack-store.ts's
                     device-local store and the shipped packs, never from a note, a bundle,
                     the working directory or an environment variable. src/lsp/ is the
                     language server with hand-written framing and no LSP library, and it
                     runs no script and no pack code. src/host-adapter.ts is its
                     HostAdapter. Its HTML export draws pack directives as the unknown
                     fallback. Probes: lsp-pack-code.probe.test.ts,
                     run-note.probe.test.ts and pack-commands.test.ts.
apps/nvim            a thin Neovim plugin in Lua, not a workspace. It starts markii lsp and
                     holds no Markii logic. test/run.sh is the headless test; CI is
                     nvim.yml. There is no mirror repository.
```

Platform renderers live under `packages/platforms/*` (a workspace root alongside
`packages/*` and `apps/*`); the neutral core packages stay directly under
`packages/*`. Future non-React renderers go under `packages/platforms/` too.
Consumer applications (the playground, the VS Code extension, the Obsidian
plugin, the CLI) go under
`apps/*`. They consume platform renderers and are not renderers themselves.

Import rule: @markii/core must never import React or anything from @markii/react;
@markii/react imports @markii/core and @markii/stdlib (the neutral contracts it
implements); the playground imports @markii/react. The conformance
corpus is plain data, with no TypeScript in `conformance/`.

## Repo structure policy (user-set 2026-08-26)

One repo, deliberately, while the host seam is still moving: app fixes
routinely land across the shared layer (`packages/markii-host`, published
since 2026-11-09 so outside apps consume the same copy) and an app in one
commit.
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
`.mkp` archives installed through the plugin are its ONLY pack path (source
live-compile and the vault folder list were removed 2026-09-02, user-set,
which also removed the compiler from the plugin), and it grows no
pack-development or export features. Note-authoring features (like Insert Component) are not
development features and belong in BOTH hosts. A future engine/host may
join the authoring side; nothing is built for that in advance.

## Stack (fixed: do not add alternatives)

- TypeScript (strict), React 18, Vite, Vitest
- Parsing: `unified`, `remark-parse`, `remark-gfm` (tables/task-lists/
  strikethrough/autolinks), `remark-directive`, `remark-frontmatter`,
  `remark-rehype`, `hast-util-to-jsx-runtime`, `mdast-util-directive`,
  `unist-util-visit`. No YAML library: the `uses:` accessor is hand-rolled
  for the simple list forms only, same philosophy as manifest validation.
- Playground editor: CodeMirror 6 (playground only)
- Bundles: `fflate` (zip form; @markii/bundle, plus the published
  @markii/host for the cascade-export zip)
- Lua sandbox: `wasmoon` (Lua 5.4 in WASM; @markii/lua only)
- Package manager: npm (workspaces). No pnpm/yarn/bun.
- VS Code extension only (`apps/vscode`, orchestrator-approved 2026-08-17;
  tsx added 2026-08-22): `@types/vscode`, `@vscode/vsce`, `esbuild`
  (extension bundling), `tsx` (dev-only: spawns the TypeScript worker
  under Vitest). These never enter `packages/*`.
- Pack compilation, added 2026-08-25 (user-approved): `esbuild-wasm`, a
  RUNTIME dependency that compiles a pack's component sources (and any CSS
  they import) at load time, so a pack needs no build step of its own. It
  lives ONLY in `packages/markii-pack-build` (`@markii/pack-build`), which
  only authoring hosts and pack build scripts import; since 2026-09-02 the
  Obsidian plugin is archive-only and carries no compiler. The rule it must
  obey: no other package declares it, so the neutral `@markii/*` packages
  stay free of a build toolchain. Publishing `@markii/pack-build` itself
  was user-approved 2026-11-09.

  The host uses esbuild-wasm's IN-PROCESS WebAssembly path (its `browser`
  entry, initialized with a compiled `WebAssembly.Module`), with sources fed
  through a resolve/load plugin rather than read from disk by esbuild. Keep
  it that way even though VS Code has a `node` binary: the in-process path
  is the one a future browser-based or Electron host can also run (its Node
  path spawns `node bin/esbuild`, which an Electron renderer cannot), and it
  measured faster cold. One path, no divergence to maintain. It costs
  roughly 14 MB unpacked in the extension, which is acceptable there.

- Browser e2e only (`e2e/browser-host`, user-approved 2026-11-09):
  `@playwright/test`, a devDependency of that standalone fixture. It never
  enters `packages/*` or the root workspaces.
- `@markii/host`'s build:dist bundles its browser worker with `esbuild`, a
  devDependency of that package only (build-time, never shipped as a
  dependency).
- Command line tool only (`apps/cli`): `esbuild` (bundling) and `tsx`
  (dev-only: spawns the TypeScript worker under Vitest), the same two
  `apps/vscode` already carries. These never enter `packages/*`.
- Obsidian plugin only (`apps/obsidian`, user-approved 2026-08-25):
  `obsidian` (API types, dev-only, external at build time) and `esbuild`
  (plugin bundling). These never enter `packages/*`.
- Terminal engine and command line tool only (`ink`, `react`,
  user-approved 2026-09-14): `ink` pinned at the current major and the
  React it peer-requires may enter `packages/platforms/markii-ansi` and
  `apps/cli`, and nowhere else. Ink's transitives come with it. The rest
  of the repo stays on React 18: only these two workspaces resolve
  React 19, and `@markii/react` is unaffected. Ink's layout module loads
  its WebAssembly through a top-level await, so any host bundling this
  engine must emit ESM; a CommonJS bundle cannot represent it.

## Architecture rules (from the spec; violations are bugs)

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
  (no MUI, Chakra, Recharts, etc.). The standard set is hand-rolled
  (the dashboard chart is dependency-free SVG, deliberately) so a component
  can never break because an upstream package did. This is a hard rule for
  the reference set (@markii/stdlib, @markii/react) and the recommended
  posture generally. There is no "port an existing external component
  library" path: external component-library dependencies are out of scope.

## Documentation style (user-set, binding)

Two kinds of documents, two different jobs. These rules govern every edit
to `README.md` and `docs/`. Violating them is rework, not taste.

**README = the front door. It links, it does not explain.** Keep it
concise (no hard line cap, per user 2026-08-31), in exactly this shape:

1. Tagline + hook: what this is and why it exists, with one tiny example,
   enough to stop a reader from leaving.
2. Getting started: install, try-it, and platform support shown as a
   showcase table (available vs planned).
3. Integrate & extend: a SHORT summary whose job is pointing into the
   `docs/` pages, never the material itself.
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
  one sentence. Split it.
- No long code inline or inside a paragraph. Code sits in short display
  blocks; if a sample grows, restructure the section instead.
- Professional documentation tone throughout. First-person diary phrasing
  ("What I did NOT test") never ships in docs/. Audit material is
  rewritten as verification status, keeping the evidence and the honesty,
  losing the diary voice.
- No em dashes in authored pages: docs/, both READMEs, and demo content.
  Rephrase with a colon, a comma, a parenthetical, or a new sentence. The
  user reads em dashes as generated-text slop; "house style" is not an
  exemption (that rationalization was tried and rejected 2026-08-18).
- Final pass on every authored page: apply the humanizer rules
  (https://raw.githubusercontent.com/blader/humanizer/refs/heads/main/SKILL.md)
  and strip inflated claims, filler, forced parallelism, decorative bolding,
  and chatbot artifacts. Reference it; do not inline it.
- While re-authoring, collect gaps and misdesigns and REPORT them; never
  silently change a design decision as part of a rewrite.
- Docs state rules, never history. A page says what holds today; how it
  came to hold belongs in `CHANGELOG.md`. Sentences built on "now", "no
  longer", "was previously", "surfaced in use", a commit hash, or an issue
  narrative are the smell (user-set 2026-09-02, after security.md and
  integration.md had grown into release notes). Verification status is the
  one exception: it keeps evidence, in the audit-status voice.
- Every status claim in a doc ("not yet implemented", "both hosts do X",
  "designed only") is checked against the code in the same commit it is
  written or touched, and the index page (`docs/README.md`) must agree with
  the topic page it points at.
- Every authored example uses attributes the component actually reads:
  grep the component or its `@markii/stdlib` contract before writing the
  snippet. A snippet that shows an attribute nothing reads is a bug.

**Sentence rules** (user-set 2026-11-10, adapted from AS-FOSS/mandible's
writing rules). They apply to `docs/`, the READMEs, CHANGELOG entries, and
every code comment or commit message written or touched from now on. The
repository's older TypeScript comments still hold em dashes and are not
rewritten in bulk. `guards/prose-rules.test.ts` holds the rules that a
script can check (em dashes, the word list, machine paths, hashes, issue
numbers and dates) for `docs/`, the READMEs and the walkthrough text.
AGENTS.md itself uses no em dashes. The one exception to the bold rule is
the lead-in on each Maintenance map entry, which works as the entry's name.

- One fact per sentence, about twenty words, plain verbs.
- No em dashes. No "not X but Y" constructions. No bold mini-headings
  inside bullets.
- Give the number or say nothing. A comparative word with no measurement
  behind it is a claim nobody made.
- Name the source. "An audit found" needs the audit, by the name a reader
  can find in this repository.
- Delete the words that survive their own deletion: crucial, delve,
  pivotal, showcase, tapestry, testament, underscore, vibrant, landscape,
  key (as an adjective), robust, leverage, seamless, comprehensive.
- No "-ing" clause bolted onto a fact to make it sound deeper.
- No dates in docs/ or READMEs. Dates live in CHANGELOG.md, and in the
  verification record of docs/security.md as the month an audit ran.

**No development artifacts in anything committed.** Public text states
facts a reader can check from the repository alone. It never cites a work
round, a batch or phase number, a brief, a worker report, anything under
`tmp/`, a chat or session, or a file outside the repository, and never an
absolute path from a developer's machine. It describes the change, never
the conversation that produced it. Code comments state the rule and point
at the test or doc that holds it; history and reasoning chains belong in
the commit message, if anywhere. Issue numbers belong in CHANGELOG.md and
commit messages, not in docs/.

**CHANGELOG.md is release notes.** It records what a user of a release
would notice: behavior, features, breaking and visual changes. Process
changes (CI, agent rules, repo tooling) never go in it. A released
section is history and is not edited afterwards.

Prefer a check over a paragraph: a rule a script can hold belongs in a
test that fails, and the rule here then points at it. Repo-wide guards
live in `guards/` and run first in root `npm test` (`npm run test:guards`):

- `guards/dev-artifacts.test.ts`: no scratch-file, work-round, machine-path
  or chat-link reference in source.
- `guards/prose-rules.test.ts`: em dashes, the word list, machine paths,
  hashes, issue numbers and dates in docs/ and the READMEs.
- `guards/agents-paths.test.ts`: every path this file names exists.

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
  npm packages. In `release.yml`, `PACKAGE_DIRS` is the ONE package list:
  the publish loop, the release tarballs, and the release notes' install
  and download sections are all generated from it (plus the CLI gate).
  Never hand-write a package name or count anywhere else in the workflow;
  a package added or removed means editing `PACKAGE_DIRS` and nothing more
  there.
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
  responsibilities in `docs/hosts.md` are the merge gate; grant persistence
  re-validates on read; bundle handling goes through `@markii/bundle`'s
  jailed storage, never a reimplemented jail.
- **Host parity** (user-set 2026-09-02) → a finding made while building,
  upgrading, or fixing ONE app (a runtime constraint, a dependency the
  host needs, a degraded mode such as a compiler-less install, a storage
  rule, an export limitation) is recorded in the host responsibilities of
  `docs/hosts.md` in the same commit, in host-neutral wording, and the other
  app is checked against it: either it already complies, it is fixed in
  the same commit, or the gap is filed as an issue named in the commit
  message. A finding that lives only in one app's source comments or
  CHANGELOG entry is lost to the next host. Concretely, that list must
  carry: which isolate kind each runtime supports and what it cannot
  bound, that pack compilation needs esbuild-wasm's in-process path and
  what a host without it does, how the worker bytes and the Lua wasm reach
  the isolate, what an export cannot contain, and where each host's
  diagnostics surface is.
- **A host behavior** (anything in createMarkiiHost: open, run, export,
  install pack, load packs, complete, hover, insert, diagnostics) → it
  lives in `packages/markii-host/src/host/`, never in an app. An app
  implements `HostAdapter` and calls `createMarkiiHost` for these
  behaviors. The linked-set (cascade) export still goes around the host
  object: the apps call `buildCascadeArchive` and its siblings from
  `@markii/host/internal`, as they do other helpers there. An app never
  imports the lower-level function a behavior is built on (`installPackFromArchive`,
  `buildExportDocument`, `discoverPacks`, `runOnce`, `spawnRun` and their
  siblings): `eslint.config.js` fails the lint on that for `apps/*/src`,
  except tests, `host-adapter.ts` and build-time pack scripts. Adding a behavior means a
  `conformance/host/` scenario plus its expected outcome in the same
  commit, and each app's adapter test picks it up automatically. A host
  that does not offer the behavior declares the capability absent rather
  than returning an empty or faked result, so the corpus records
  `unsupported` instead of a false success. An adapter is constructible
  from injected dependencies: one that reads a module-scope global or
  imports its host SDK directly cannot be driven by the corpus, and that
  is a bug, not a style preference.
- **Any change visible in authored Markii content** (directive naming or
  composition, component names/attributes, script or frontmatter syntax) →
  sweep ALL demo and doc content in the same pass: `README.md`'s example,
  `docs/` snippets, both apps' READMEs and the VS Code
  walkthrough, the `markii-vault` repo (the tour note, the other example notes, example packs,
  playground `@markii/*` deps. It consumes published npm versions, so it
  updates after the npm release, not before), and the `markii-packs` repo
  (every pack's components, README, and example note; its CI consumes
  published `@markii/pack`/`@markii/react`, so like the vault it updates
  after the npm release).
- **New export from `@markii/host`'s main entry** → it must stay
  environment-neutral transitively (no `node:*`, `esbuild-wasm`,
  `@markii/react` or `@markii/html` at runtime);
  `packages/markii-host/src/neutral-entries.probe.test.ts` is the gate. A module
  needing any of those goes behind `@markii/host/node`.
- **Editor-seam change** (completion, hover, the insert skeleton or catalog,
  fence lengthening) → it lives in `@markii/stdlib/editor`, a PUBLISHED
  subpath, so it needs a CHANGELOG entry and the editor-support section of
  `docs/hosts.md` in the same commit. `@markii/host` only re-exports
  it; do not add a second copy there.
- **A renderer that recognizes a value and declines to use it** (an
  out-of-enum attribute value, a refused source) → it renders anyway with a
  quiet marker, reports the same wording through `onDiagnostic`, and both
  hosts route that to their diagnostics surface. An unknown attribute NAME
  stays silent: packs and later format versions use names this version does
  not know.
- **Security probe suites are product code** → colocated `*probe*` suites are
  committed and kept green in CI (the documented hang/deadlock repros are the
  one exception: they are covered by dedicated tests rather than re-executed,
  since re-triggering a genuine hang would wedge the runner). A probe is
  never removed or weakened to make a suite pass. Pass 1's probe suite was
  lost as an untracked file; committing these suites makes that class of
  evidence loss impossible.
- **A path named in this file** (a file moved, renamed or removed, a new
  layout entry) → `guards/agents-paths.test.ts` fails until this file names
  the real path. A generated file goes in its `ALLOWLIST` with the reason.
- **A change to the exported names of `@markii/host`** (any published
  entry, `/internal` included) → `packages/markii-host/src/published-surface.test.ts` fails
  until the snapshot in `src/published-surface/` is regenerated with
  `UPDATE_HOST_SURFACE=1 npm test -w @markii/host`. The change needs a
  CHANGELOG entry.
- **Rename/move of any top-level doc** → fix every cross-reference in the
  same commit: `README.md`, this file, `TODO.md`, `docs/`, and source
  comments (grep for the old name).
- **Work state** → `TODO.md` is the authoritative queue but is LOCAL-ONLY
  (gitignored since 2026-08-18, pending items only); the public roadmap is
  GitHub issues. Decisions with lasting effect go in the spec or an issue,
  never only in chat history or the local queue.

## Session rules for agents

- Subagents must NOT run any `git` command at all, read-only ones
  included (no status, diff, log, commit, branch, or init).
  The orchestrator commits. Report what you changed instead.
- Do not create files outside your assigned scope; if two agents run in
  parallel they own disjoint directories.
- Verify before reporting done: `npm test`, `npm run build`, `npm run lint`
  must all pass from the repo root. Report actual command output, not claims.
- Do not edit the `docs/` pages or AGENTS.md; propose changes in your report
  instead. (The orchestrator owns spec and docs edits, unless a brief says
  otherwise.)
- Never cite a brief, a `tmp/` file, a batch, a phase or a review in code,
  comments, docs or commit text.
- Workers get a brief on disk (`tmp/BRIEF-*.md`, gitignored) and return
  their report as their final message (the harness refuses report files
  from subagents); the orchestrator saves it as `tmp/REPORT-*.md`. A report
  covers files changed, decisions and why, what was not done and why,
  actual gate output, proposed docs and CHANGELOG text.

## Orchestrator rules (user-set 2026-11-09)

- A worker's report is a claim, not evidence. Before committing worker
  output the orchestrator itself: reruns `npm test`, `npm run build` and
  `npm run lint` from the root; reads the whole diff; checks every
  decision in the report against the brief and this file; and spot-checks
  any "verified" or "no change" claim (fixtures byte-identical, probe
  still green, bundle no longer carries X) with its own command.
- One deliverable per commit. Docs, CHANGELOG and this file are updated
  by the orchestrator in the same commit as the code they describe.
- Unattended runs: a blocker that needs the user stops only the work it
  touches. Everything unaffected is finished, the blockers are collected,
  and the run ends with one report. A minor question the orchestrator
  does not want to decide alone becomes a GitHub issue with the details
  and reasoning, and the work continues.
- Progress lives on disk (`tmp/PLAN.md`, `TODO.md`) and is updated as each
  piece lands, so a context compaction loses nothing.

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

- `npm test`: run all workspace tests
- `npm run build`: build all workspaces
- `npm run lint`: lint all workspaces
- `npm run dev`: start the playground
