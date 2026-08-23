#!/usr/bin/env node
// Regenerates src/doc-css.generated.ts from @markii/react's src/doc.css —
// the ONE stylesheet both platform renderers share (AGENTS.md: "doc.css
// document rhythm + component internals"; markup/classes are kept identical
// between @markii/react and @markii/html precisely so this one file styles
// both). Run automatically before test/build (see package.json's
// pretest/prebuild/prebuild:dist hooks) so the embedded copy this package
// ships in `exportHtmlDocument` can never drift from the source of truth by
// hand-editing — it is generated, never authored here.
//
// Plain `node scripts/generate-doc-css.ts` (no build step): Node's built-in
// TypeScript type-stripping runs this directly, the same way
// `@markii/core`'s `scripts/regen-corpus.ts` already does in this repo.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// packages/platforms/markii-html/scripts -> packages/platforms/markii-html -> packages/platforms
const platformsDir = join(here, '..', '..');
const sourcePath = join(platformsDir, 'markii-react', 'src', 'doc.css');
const outPath = join(here, '..', 'src', 'doc-css.generated.ts');

const css = readFileSync(sourcePath, 'utf8');

const banner = `// GENERATED FILE — do not edit by hand.
// Regenerate with: node scripts/generate-doc-css.ts
// Source of truth: packages/platforms/markii-react/src/doc.css
`;

const body = `${banner}
/** The shared document stylesheet (@markii/react's doc.css), embedded as a string for exportHtmlDocument's <style> block. */
export const DOC_CSS: string = ${JSON.stringify(css)};
`;

writeFileSync(outPath, body, 'utf8');
console.log(`wrote ${outPath} (${String(css.length)} bytes of source CSS)`);
