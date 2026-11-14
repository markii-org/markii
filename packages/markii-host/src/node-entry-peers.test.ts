// `@markii/host/node` must load with no optional peer installed: nothing it
// reaches by relative import may name `@markii/html` or `@markii/react`. The
// HTML engine is its own entry, `@markii/host/html-engine`.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const IMPORT =
  /(?:^|\n)\s*(?:import|export)\s[^'"\n;]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function sourceFor(base: string): string {
  const stem = base.replace(/\.js$/, '');
  for (const candidate of [
    `${stem}.ts`,
    `${stem}.tsx`,
    join(stem, 'index.ts'),
  ]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // try the next form
    }
  }
  throw new Error(`cannot find the source for ${base}`);
}

function reachableBareSpecifiers(entry: string): Map<string, string> {
  const bare = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const match of text.matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (specifier === undefined) continue;
      if (specifier.startsWith('.')) {
        queue.push(sourceFor(resolve(dirname(file), specifier)));
      } else if (!bare.has(specifier)) {
        bare.set(specifier, file);
      }
    }
  }
  return bare;
}

describe('@markii/host/node', () => {
  it('reaches no optional peer package', () => {
    const bare = reachableBareSpecifiers(join(here, 'node.ts'));
    const optional = [...bare.keys()].filter((specifier) =>
      /^@markii\/(html|react)(\/|$)/.test(specifier),
    );
    expect(optional).toEqual([]);
  });

  it('is checking something: the graph reaches node:fs', () => {
    const bare = reachableBareSpecifiers(join(here, 'node.ts'));
    expect([...bare.keys()].some((s) => s.startsWith('node:'))).toBe(true);
  });

  it('the HTML engine entry does reach @markii/html', () => {
    const bare = reachableBareSpecifiers(join(here, 'html-engine.ts'));
    expect(bare.has('@markii/html')).toBe(true);
  });
});
