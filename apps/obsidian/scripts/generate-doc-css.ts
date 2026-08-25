#!/usr/bin/env node
// Regenerates styles.css from @markii/react's src/doc.css plus this
// workspace's own small Obsidian theme layer (src/obsidian-theme.css) —
// the same "generate, never hand-copy" approach
// packages/platforms/markii-html/scripts/generate-doc-css.ts uses for
// doc.css (AGENTS.md: doc.css is "document rhythm + component internals",
// shared verbatim by every renderer). Run automatically before test/build
// (see package.json's pretest/prebuild hooks) so the styles.css Obsidian
// loads for this plugin can never drift from the source of truth by
// hand-editing — it is generated, never authored here.
//
// Plain `node scripts/generate-doc-css.ts` (no build step): Node's built-in
// TypeScript type-stripping runs this directly, the same way
// `@markii/html`'s script and `@markii/core`'s `scripts/regen-corpus.ts`
// already do in this repo.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// apps/obsidian/scripts -> apps/obsidian -> apps -> repo root
const repoRoot = join(here, '..', '..', '..');
const docCssPath = join(
  repoRoot,
  'packages',
  'platforms',
  'markii-react',
  'src',
  'doc.css',
);
const themePath = join(here, '..', 'src', 'obsidian-theme.css');
const outPath = join(here, '..', 'styles.css');

const docCss = readFileSync(docCssPath, 'utf8');
const theme = readFileSync(themePath, 'utf8');

const banner = `/* GENERATED FILE — do not edit by hand.
 * Regenerate with: node scripts/generate-doc-css.ts
 * Sources, in cascade order:
 *   1. packages/platforms/markii-react/src/doc.css (shared document rhythm
 *      + component internals; identical to what @markii/html and the VS
 *      Code extension's webview embed)
 *   2. src/obsidian-theme.css (this workspace's small Obsidian color
 *      overrides, kept as an authored source file — only THIS generated
 *      concatenation is gitignored)
 */
`;

writeFileSync(outPath, `${banner}\n${docCss}\n${theme}`, 'utf8');
console.log(
  `wrote ${outPath} (${String(docCss.length)} bytes doc.css + ${String(theme.length)} bytes theme)`,
);
