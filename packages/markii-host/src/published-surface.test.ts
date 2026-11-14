// The exported names of each published @markii/host entry are pinned to a
// committed snapshot, so adding, removing or renaming an export is a visible
// diff. Names come from the TypeScript compiler, so types are included and
// `export *` re-exports are resolved.
//
// To accept an intended change:
//   UPDATE_HOST_SURFACE=1 npm test -w @markii/host
// An intended change to this surface also needs a CHANGELOG.md entry.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const snapshotDirectory = join(here, 'published-surface');

const ENTRIES = [
  'index',
  'internal',
  'node',
  'html-engine',
  'browser',
  'conformance',
] as const;

function createProgram(): ts.Program {
  const configPath = join(packageRoot, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    packageRoot,
  );
  return ts.createProgram({
    rootNames: ENTRIES.map((entry) => join(here, `${entry}.ts`)),
    options: { ...parsed.options, noEmit: true, skipLibCheck: true },
  });
}

function exportedNames(program: ts.Program, entry: string): string[] {
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(join(here, `${entry}.ts`));
  if (!sourceFile) throw new Error(`Entry source not found: ${entry}.ts`);
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) throw new Error(`${entry}.ts is not a module`);
  return checker
    .getExportsOfModule(moduleSymbol)
    .map((symbol) => symbol.getName())
    .filter((name) => name !== 'default')
    .sort();
}

function snapshotPath(entry: string): string {
  return join(snapshotDirectory, `${entry}.txt`);
}

describe('@markii/host published surface', () => {
  const program = createProgram();

  for (const entry of ENTRIES) {
    it(`${entry}.ts exports exactly the committed names`, () => {
      const names = exportedNames(program, entry);
      const text = `${names.join('\n')}\n`;
      if (process.env['UPDATE_HOST_SURFACE'] === '1') {
        mkdirSync(snapshotDirectory, { recursive: true });
        writeFileSync(snapshotPath(entry), text);
        return;
      }
      const path = snapshotPath(entry);
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
          `The published surface of @markii/host/${entry} changed.`,
          `Added: ${added.join(', ') || '(none)'}`,
          `Removed: ${removed.join(', ') || '(none)'}`,
          `If this is intended, run UPDATE_HOST_SURFACE=1 npm test -w @markii/host`,
          `to rewrite src/published-surface/${entry}.txt, and add a CHANGELOG.md entry:`,
          `consumers outside this repository import these names.`,
        ].join('\n'),
      ).toEqual({ added: [], removed: [] });
    });
  }
});
