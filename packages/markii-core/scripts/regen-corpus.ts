import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'prettier';
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
 * The written JSON is `stableStringify`'s deterministic, sorted-key output
 * reformatted through Prettier (`parser: 'json'`) before hitting disk: plain
 * `JSON.stringify(..., null, 2)` always expands every array one-item-per-line,
 * but Prettier's JSON printer collapses a short array of scalars onto one
 * line (e.g. a GFM table's `align: [null, null, "center"]`) — without this
 * step, any fixture whose AST contains such an array would fail `npm run
 * lint`'s `prettier --check` the moment it was regenerated, since
 * `conformance/` is not exempt from the formatting gate.
 *
 * Run directly with `node` (this package's `package.json` sets
 * `"type": "module"`, and Node's built-in TypeScript support strips types
 * at load time) — no bundler required. Imports here use explicit `.ts`
 * extensions because plain `node` module resolution (unlike Vite/Vitest)
 * requires them; `../src/parse.ts` and `../src/corpus.ts` were kept free of
 * their own relative imports specifically so they can be loaded this way.
 */
async function main(): Promise<void> {
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
    const formatted = await format(stableStringify(ast), { parser: 'json' });
    writeFileSync(jsonPath, formatted);
    console.log(`regenerated ${name}.json`);
  }
}

main();
