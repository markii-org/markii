#!/usr/bin/env node
// Run `npm run build:dist` first (or just `npm run regenerate:fixtures`,
// which does it for you): this script imports the BUILT `dist/` output, not
// `src/` directly. `src/`'s own relative imports use NodeNext's `.js`
// specifier convention (`./ansi.js` naming a sibling `ansi.ts`), which is
// exactly what `tsc -p tsconfig.build.json` resolves when it emits `dist/`
// — Node's own type-stripping resolves a bare specifier only against a
// REAL file, so it cannot follow that convention straight out of `src/`
// the way `@markii/core`'s `scripts/regen-corpus.ts` can (that package's
// sibling imports are the same convention, but this script would need to
// duplicate the whole module graph's resolution logic to short-circuit it;
// importing the already-built `dist/` is simpler and no less deliberate).
/**
 * Regenerates `conformance/render/<name>.txt` (every render-level fixture,
 * width 80, color `'never'`) and `conformance/render/01-unknown-component.ansi`
 * (the same fixture at color `'truecolor'`, to lock the escape sequences)
 * for `@markii/ansi`.
 *
 * DELIBERATE, MANUAL ONLY: this script is never wired into `pretest`,
 * `prebuild`, or any other automatic hook (AGENTS.md's batch-9 brief). A
 * fixture is regenerated on purpose, by a person who has just read the diff
 * and confirmed it is a real improvement, not a side effect of running
 * tests or a build. Run it with `npm run regenerate:fixtures` from this
 * package, then READ every changed `.txt`/`.ansi` file before committing —
 * a fixture that captures a bug locks the bug in.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { conformanceDir } from '@markii/core/corpus';
import { renderMarkToAnsi } from '@markii/ansi';
import { defaultAnsiRegistry } from '@markii/ansi/components';

const renderFixturesDir = join(conformanceDir(), 'render');
const MK_EXTENSION = '.mk.md';

function listRenderFixtureNames(): string[] {
  return readdirSync(renderFixturesDir)
    .filter((entry) => entry.endsWith(MK_EXTENSION))
    .map((entry) => entry.slice(0, -MK_EXTENSION.length))
    .sort();
}

const names = listRenderFixtureNames();
if (names.length === 0) {
  throw new Error(`no *.mk.md fixtures found under ${renderFixturesDir}`);
}

for (const name of names) {
  const input = readFileSync(join(renderFixturesDir, `${name}.mk.md`), 'utf8');
  const text = await renderMarkToAnsi(
    input,
    defaultAnsiRegistry,
    undefined,
    undefined,
    {
      width: 80,
      color: 'never',
    },
  );
  writeFileSync(join(renderFixturesDir, `${name}.txt`), text);
  console.log(`wrote ${name}.txt`);
}

const FIRST_FIXTURE = names[0];
if (FIRST_FIXTURE) {
  const input = readFileSync(
    join(renderFixturesDir, `${FIRST_FIXTURE}.mk.md`),
    'utf8',
  );
  const ansi = await renderMarkToAnsi(
    input,
    defaultAnsiRegistry,
    undefined,
    undefined,
    {
      width: 80,
      color: 'truecolor',
    },
  );
  writeFileSync(join(renderFixturesDir, `${FIRST_FIXTURE}.ansi`), ansi);
  console.log(`wrote ${FIRST_FIXTURE}.ansi`);
}
