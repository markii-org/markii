// The exported names of every published package entry are pinned to a
// committed snapshot, so adding, removing or renaming an export is a visible
// diff. Names come from the TypeScript compiler, so types are included and
// `export *` re-exports are resolved. The package list is release.yml's
// PACKAGE_DIRS. @markii/host pins its own entries in its own package, because
// its snapshot also gates the host test run.
//
// To accept an intended change:
//   UPDATE_SURFACE=1 npm run test:guards
// An intended change to a published surface also needs a CHANGELOG.md entry.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './repo-files.ts';

const snapshotDirectory = join(repoRoot, 'guards', 'published-surface');
const SELF_PINNED = new Set(['@markii/host']);

interface Entry {
  readonly label: string;
  readonly source: string;
}

function packageDirs(): string[] {
  const workflow = readFileSync(
    join(repoRoot, '.github', 'workflows', 'release.yml'),
    'utf8',
  );
  const match = /PACKAGE_DIRS: >-\n((?:\s+packages\/\S+\n)+)/.exec(workflow);
  if (!match?.[1]) throw new Error('release.yml names no PACKAGE_DIRS list');
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Each script entry of the exports map, resolved to the source file behind its `dist` path. */
function entriesOf(dir: string): { name: string; entries: Entry[] } {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, dir, 'package.json'), 'utf8'),
  ) as { name: string; exports?: Record<string, { import?: string }> };
  const entries: Entry[] = [];
  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    const built = typeof target === 'object' ? target.import : undefined;
    if (built === undefined || !/^\.\/dist\/.+\.js$/.test(built)) continue;
    const stem = built.slice('./dist/'.length, -'.js'.length);
    const source = [`src/${stem}.ts`, `src/${stem}.tsx`]
      .map((file) => join(repoRoot, dir, file))
      .find((file) => existsSync(file));
    if (source === undefined) {
      throw new Error(`${manifest.name} ${subpath}: no source for ${built}`);
    }
    entries.push({
      label: subpath === '.' ? 'index' : subpath.slice(2).replace(/\W+/g, '-'),
      source,
    });
  }
  return { name: manifest.name, entries };
}

const packages = packageDirs()
  .map(entriesOf)
  .filter((pkg) => !SELF_PINNED.has(pkg.name));

function createProgram(): ts.Program {
  const configPath = join(repoRoot, 'tsconfig.dev.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, repoRoot);
  return ts.createProgram({
    rootNames: packages.flatMap((pkg) => pkg.entries.map((e) => e.source)),
    options: { ...parsed.options, noEmit: true, skipLibCheck: true },
  });
}

describe('published package surfaces', () => {
  it('names every package from release.yml', () => {
    expect(packages.length).toBeGreaterThanOrEqual(10);
  });

  const program = createProgram();
  const checker = program.getTypeChecker();

  for (const pkg of packages) {
    const folder = pkg.name.replace('@markii/', '');
    for (const entry of pkg.entries) {
      it(`${pkg.name} ${entry.label} exports exactly the committed names`, () => {
        const sourceFile = program.getSourceFile(entry.source);
        const moduleSymbol =
          sourceFile && checker.getSymbolAtLocation(sourceFile);
        if (!moduleSymbol) throw new Error(`${entry.source} is not a module`);
        const names = checker
          .getExportsOfModule(moduleSymbol)
          .map((symbol) => symbol.getName())
          .filter((name) => name !== 'default')
          .sort();
        const path = join(snapshotDirectory, folder, `${entry.label}.txt`);
        if (process.env['UPDATE_SURFACE'] === '1') {
          mkdirSync(join(snapshotDirectory, folder), { recursive: true });
          writeFileSync(path, `${names.join('\n')}\n`);
          return;
        }
        const committed = existsSync(path)
          ? readFileSync(path, 'utf8')
              .split('\n')
              .filter((n) => n !== '')
          : [];
        const added = names.filter((n) => !committed.includes(n));
        const removed = committed.filter((n) => !names.includes(n));
        expect(
          { added, removed },
          [
            `The published surface of ${pkg.name} (${entry.label}) changed.`,
            `Added: ${added.join(', ') || '(none)'}`,
            `Removed: ${removed.join(', ') || '(none)'}`,
            'If this is intended, run UPDATE_SURFACE=1 npm run test:guards',
            `to rewrite guards/published-surface/${folder}/${entry.label}.txt,`,
            'and add a CHANGELOG.md entry: consumers import these names.',
          ].join('\n'),
        ).toEqual({ added: [], removed: [] });
      });
    }
  }
});
