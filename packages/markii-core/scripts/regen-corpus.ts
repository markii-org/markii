import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../src/parse.ts';
import {
  conformanceDir,
  listCorpusNames,
  stableStringify,
  stripPositions,
} from '../src/corpus.ts';

/** The Mark document extension. Compound (two dots) — never derive it via `path.extname()`. */
const DOC_EXTENSION = '.mk.md';

/**
 * Regenerates every expected-AST `<name>.json` fixture in the repo-root
 * `conformance/` directory from the current `parse()` output of its
 * `<name>.mk.md` sibling. This is the ONLY place expected-AST JSON is
 * written — running the test suite must never write to `conformance/`, so a
 * stale fixture only ever changes when someone explicitly runs
 * `npm run corpus:regen -w @markii/core` and reviews the diff.
 *
 * Run directly with `node` (this package's `package.json` sets
 * `"type": "module"`, and Node's built-in TypeScript support strips types
 * at load time) — no bundler or extra dependency required. Imports here use
 * explicit `.ts` extensions because plain `node` module resolution (unlike
 * Vite/Vitest) requires them; `../src/parse.ts` and `../src/corpus.ts` were
 * kept free of their own relative imports specifically so they can be
 * loaded this way.
 */
function main(): void {
  const dir = conformanceDir();
  const names = listCorpusNames(dir);

  if (names.length === 0) {
    console.warn(`no *${DOC_EXTENSION} fixtures found in ${dir}`);
    return;
  }

  for (const name of names) {
    const smdPath = join(dir, `${name}${DOC_EXTENSION}`);
    const jsonPath = join(dir, `${name}.json`);
    const input = readFileSync(smdPath, 'utf8');
    const ast = stripPositions(parse(input));
    writeFileSync(jsonPath, stableStringify(ast));
    console.log(`regenerated ${name}.json`);
  }
}

main();
