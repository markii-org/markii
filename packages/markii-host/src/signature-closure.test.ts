// A host author writes against `MarkiiHost`, `HostAdapter` and
// `MarkiiHostOptions`. Every type named anywhere in their signatures, and
// in the request and outcome types those reach, has to be exported from the
// main entry. Without that, a consumer cannot name a parameter or a result
// it receives. The check walks the type nodes with the TypeScript compiler
// and compares what it reaches to the entry's exports.
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const sourceRoot = join(packageRoot, 'src') + sep;

const ROOTS = ['MarkiiHost', 'HostAdapter', 'MarkiiHostOptions'] as const;

function createProgram(): ts.Program {
  const configPath = join(packageRoot, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    packageRoot,
  );
  return ts.createProgram({
    rootNames: [join(here, 'index.ts')],
    options: { ...parsed.options, noEmit: true, skipLibCheck: true },
  });
}

function resolved(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

/** Whether a declared symbol is a named type declared in this package's own source. */
function isOwnNamedType(symbol: ts.Symbol): boolean {
  const named =
    ts.SymbolFlags.Interface |
    ts.SymbolFlags.TypeAlias |
    ts.SymbolFlags.Class |
    ts.SymbolFlags.Enum;
  if ((symbol.flags & named) === 0) return false;
  return (symbol.declarations ?? []).some((declaration) => {
    const file = declaration.getSourceFile().fileName;
    return file.startsWith(sourceRoot) && !file.includes('.test.');
  });
}

function reachedFrom(
  program: ts.Program,
  checker: ts.TypeChecker,
  rootSymbols: readonly ts.Symbol[],
): Map<string, ts.Symbol> {
  const reached = new Map<string, ts.Symbol>();
  const queue: ts.Symbol[] = [...rootSymbols];
  const scanned = new Set<ts.Symbol>();

  const noteReference = (name: ts.Node): void => {
    const symbol = checker.getSymbolAtLocation(name);
    if (symbol === undefined) return;
    const target = resolved(checker, symbol);
    if (!isOwnNamedType(target)) return;
    if (!reached.has(target.getName())) reached.set(target.getName(), target);
    if (!scanned.has(target)) queue.push(target);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node)) noteReference(node.typeName);
    else if (ts.isExpressionWithTypeArguments(node)) {
      noteReference(node.expression);
    }
    ts.forEachChild(node, visit);
  };

  while (queue.length > 0) {
    const symbol = queue.pop()!;
    if (scanned.has(symbol)) continue;
    scanned.add(symbol);
    for (const declaration of symbol.declarations ?? []) visit(declaration);
  }
  void program;
  return reached;
}

describe('@markii/host main entry signature closure', () => {
  it('exports every type named in the signatures of MarkiiHost, HostAdapter and MarkiiHostOptions', () => {
    const program = createProgram();
    const checker = program.getTypeChecker();
    const entry = program.getSourceFile(join(here, 'index.ts'));
    if (!entry) throw new Error('index.ts not found');
    const moduleSymbol = checker.getSymbolAtLocation(entry);
    if (!moduleSymbol) throw new Error('index.ts is not a module');
    const exports = checker.getExportsOfModule(moduleSymbol);
    const exportedSymbols = new Set(
      exports.map((symbol) => resolved(checker, symbol)),
    );

    const roots = ROOTS.map((name) => {
      const found = exports.find((symbol) => symbol.getName() === name);
      if (!found) throw new Error(`${name} is not exported from index.ts`);
      return resolved(checker, found);
    });

    const reached = reachedFrom(program, checker, roots);
    const missing = [...reached.entries()]
      .filter(([, symbol]) => !exportedSymbols.has(symbol))
      .map(([name]) => name)
      .sort();
    expect(
      missing,
      `These types appear in a published signature but are not exported from @markii/host: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
