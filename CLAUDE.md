# Super Markdown (.smd)

An extensible markdown format: CommonMark + generic directives that render the
author's own React components. **The product is the file format and its reference
library — not an app.** Read `DESIGN.md` (the spec) before writing any code; it is
the source of truth for syntax, architecture, and scope.

## Repo layout (npm workspaces)

```
DESIGN.md            the format spec — source of truth
conformance/         language-agnostic corpus: *.smd inputs + expected-AST *.json
packages/smd-core    framework-agnostic reference impl — ZERO React dependency:
  src/parse.ts       text → mdast AST (unified + remark-parse + remark-directive)
  src/to-hast.ts     mdast → hast: directive tagging (data.hName) + URL sanitizer
  src/corpus.ts      conformance-corpus runner (load fixtures, strip positions)
packages/smd-react   the reference L1 renderer (one consumer of smd-core):
  src/registry.ts    Registry types + createRegistry/mergeRegistries
  src/render.tsx     hast + registry → React tree (incl. unknown-directive fallback)
  src/components/    built-in demo components (callout, kbd, ...)
  src/doc.css        document rhythm + component internals
packages/smd-bundle  .smdb bundle handling (spec §9–11, L2) — no React, no parsing:
  src/manifest.ts    manifest.json types + hand-rolled validation (no schema deps)
  src/paths.ts       path-jail: bundle-relative path normalization/rejection
  src/zip.ts         zip form via fflate (browser-safe main entry)
  src/fs.ts          directory form via node:fs (Node-only "./fs" subpath export)
  src/script-view.ts capability-restricted view for future script runtime (§11)
apps/playground      thin Vite dev harness to view .smd files. NOT the product.
```

Import rule: smd-core must never import React or anything from smd-react;
smd-react imports smd-core; the playground imports smd-react. The conformance
corpus is plain data — no TypeScript in `conformance/`.

## Stack (fixed — do not add alternatives)

- TypeScript (strict), React 18, Vite, Vitest
- Parsing: `unified`, `remark-parse`, `remark-directive`, `remark-rehype`,
  `hast-util-to-jsx-runtime`, `mdast-util-directive`, `unist-util-visit`
- Playground editor: CodeMirror 6 (playground only)
- Bundles: `fflate` (zip form; smd-bundle only)
- Later phases only: wasmoon (Lua sandbox)
- Package manager: npm (workspaces). No pnpm/yarn/bun.

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
- Formatting: Prettier defaults. Lint: ESLint flat config, typescript-eslint
  recommended. Both must pass.
- Dependencies: only what's listed under Stack. Adding anything else requires
  explicit approval from the orchestrator.

## Session rules for agents

- Subagents must NOT run any `git` command (no commit, no branch, no init).
  The orchestrator commits. Report what you changed instead.
- Do not create files outside your assigned scope; if two agents run in
  parallel they own disjoint directories.
- Verify before reporting done: `npm test`, `npm run build`, `npm run lint`
  must all pass from the repo root. Report actual command output, not claims.
- Do not edit DESIGN.md or CLAUDE.md; propose changes in your report instead.

## Commands (repo root)

- `npm test` — run all workspace tests
- `npm run build` — build all workspaces
- `npm run lint` — lint all workspaces
- `npm run dev` — start the playground
