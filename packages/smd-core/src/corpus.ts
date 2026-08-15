import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The language-agnostic conformance corpus: `*.smd` inputs plus expected-AST
 * `*.json` siblings, living at the repo root (see DESIGN.md §13). This
 * module is deliberately parser-agnostic — it only loads/compares corpus
 * data — so it's usable from any package's tests (or a future non-JS
 * implementation's tooling), not just `smd-core`'s own parser tests.
 */

/**
 * Resolves the repo-root `conformance/` directory relative to this module's
 * own file location (not `process.cwd()`), so it works the same whether
 * tests run from the repo root or from within a single workspace (each
 * workspace's `vitest run` / `node` invocation has a different cwd).
 */
export function conformanceDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // packages/smd-core/src -> packages/smd-core -> packages -> repo root
  return join(here, '..', '..', '..', 'conformance');
}

export interface CorpusCase {
  /** Fixture name, e.g. `"01-plain-markdown"` (no extension). */
  name: string;
  /** Absolute path to the `.smd` input file. */
  smdPath: string;
  /** Absolute path to the sibling expected-AST `.json` file. */
  jsonPath: string;
  /** Raw `.smd` source text. */
  input: string;
  /** Parsed expected-AST JSON (already position-free). */
  expected: unknown;
}

/** Base fixture names (no extension) for every `*.smd` file in `dir`, sorted. */
export function listCorpusNames(dir: string = conformanceDir()): string[] {
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.smd'))
    .map((entry) => entry.slice(0, -'.smd'.length))
    .sort();
}

/**
 * Loads every `<name>.smd` / `<name>.json` pair from `dir` (default: the
 * repo-root `conformance/` directory). A `.smd` file with no matching
 * `.json` sibling throws (surfacing the missing fixture loudly rather than
 * silently skipping a corpus case).
 */
export function loadCorpusCases(dir: string = conformanceDir()): CorpusCase[] {
  return listCorpusNames(dir).map((name) => {
    const smdPath = join(dir, `${name}.smd`);
    const jsonPath = join(dir, `${name}.json`);
    const input = readFileSync(smdPath, 'utf8');
    const expected: unknown = JSON.parse(readFileSync(jsonPath, 'utf8'));
    return { name, smdPath, jsonPath, input, expected };
  });
}

/**
 * Recursively strips every `position` field from a parsed tree (unist nodes
 * carry `position` with line/column/offset info that's irrelevant to
 * structural conformance and would make corpus fixtures brittle to
 * reformat). Generic over any plain-data tree shape, not just mdast, so it
 * doubles as a hast-position-stripper if a future corpus level needs one.
 */
export function stripPositions<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => stripPositions(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'position') continue;
      result[key] = stripPositions(val);
    }
    return result as T;
  }
  return value;
}

/** Deep-clones `value` with every object's keys sorted alphabetically. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => sortKeysDeep(item));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeysDeep(source[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Serializes `value` as pretty-printed JSON with a deterministic, sorted key
 * order (so regenerated expected-AST fixtures diff cleanly and don't depend
 * on incidental object-construction order) and a trailing newline.
 */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}
