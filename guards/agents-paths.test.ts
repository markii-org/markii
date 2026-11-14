// Every file or folder AGENTS.md names exists. The "Repo layout" block uses
// shorthand, so the extractor resolves indented entries against the package
// or app heading they sit under.
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listRepoFiles, readRepoFile, repoRoot } from './repo-files.ts';

/** A path that starts here is resolved from the repository root. */
const TOP_LEVEL_ROOTS = [
  'apps/',
  'packages/',
  'docs/',
  'conformance/',
  'e2e/',
  'packs/',
  'scripts/',
  'skills/',
  '.github/',
];
/** An entry that starts here, under a layout heading, is resolved against that heading's folder. */
const SECTION_RELATIVE_ROOTS = [
  'src/',
  'scripts/',
  'syntaxes/',
  'test-fixtures/',
  'walkthrough/',
  'lua/',
  'plugin/',
  'test/',
];
const BARE_FILE = /^[\w.-]+\.(?:ts|tsx|mjs|css|md|lua)$/;
const HAS_EXTENSION = /\.[a-z]{1,4}$/;

/** Names AGENTS.md uses that are not files in a fresh checkout. */
const ALLOWLIST: { name: string; reason: string }[] = [
  {
    name: 'doc-css.generated.ts',
    reason: 'generated, gitignored',
  },
  {
    name: 'doc.css',
    reason: 'owned by @markii/react and named from the other packages',
  },
  {
    name: 'styles.css',
    reason: 'generated, gitignored: the stylesheet the Obsidian plugin ships',
  },
  {
    name: 'webview.css',
    reason: 'generated, the stylesheet a prebuilt pack ships beside webview.js',
  },
];

type Mode = 'exact' | 'bare' | 'folder-relative';

interface Reference {
  path: string;
  line: number;
  mode: Mode;
  /** The package or app the layout entry sits under. */
  sectionRoot?: string;
}

function cleanToken(raw: string): string {
  return raw
    .replace(/^[`'"(\[]+/, '')
    .replace(/[`'")\],;:]+$/, '')
    .replace(/\.$/, '');
}

function expandBraces(token: string): string[] {
  const match = /^(.*)\{([^{}]+)\}(.*)$/.exec(token);
  if (!match) return [token];
  const [, head = '', body = '', tail = ''] = match;
  return body.split(',').flatMap((part) => expandBraces(head + part + tail));
}

function isSkipped(token: string): boolean {
  return (
    /[*<>$]/.test(token) ||
    token.includes('...') ||
    token.startsWith('tmp/') ||
    token.startsWith('dist/') ||
    token.startsWith('http')
  );
}

function startsWithAny(token: string, prefixes: string[]): boolean {
  return prefixes.some((p) => token.startsWith(p));
}

function extractReferences(): Reference[] {
  const lines = readRepoFile('AGENTS.md').split('\n');
  const refs: Reference[] = [];
  let inLayout = false;
  let sectionRoot: string | undefined;

  lines.forEach((text, index) => {
    const line = index + 1;
    if (/^```/.test(text)) {
      inLayout = !inLayout && lines[index + 1]?.startsWith('docs/') === true;
      sectionRoot = undefined;
      return;
    }
    const isHeading = inLayout && /^\S/.test(text);
    if (isHeading) {
      sectionRoot = cleanToken(text.split(/\s+/)[0] ?? '').replace(/\/$/, '');
    }
    const lenient =
      sectionRoot !== undefined &&
      (sectionRoot.startsWith('packages/') || sectionRoot.startsWith('apps/'));

    for (const raw of text.split(/\s+/)) {
      const token = cleanToken(raw);
      if (token === '' || isSkipped(token)) continue;
      for (const path of expandBraces(token)) {
        const sectionRelative = startsWithAny(path, SECTION_RELATIVE_ROOTS);
        const isPath = HAS_EXTENSION.test(path) || path.endsWith('/');
        if (
          startsWithAny(path, TOP_LEVEL_ROOTS) &&
          (isHeading || !inLayout || !sectionRelative)
        ) {
          if (isPath) refs.push({ path, line, mode: 'exact' });
        } else if (inLayout && sectionRoot !== undefined && sectionRelative) {
          if (isPath) {
            refs.push({ path: `${sectionRoot}/${path}`, line, mode: 'exact' });
          }
        } else if (
          inLayout &&
          lenient &&
          BARE_FILE.test(path) &&
          !path.startsWith('.')
        ) {
          refs.push({ path, line, mode: 'bare', sectionRoot });
        } else if (
          inLayout &&
          lenient &&
          path.includes('/') &&
          BARE_FILE.test(basename(path))
        ) {
          refs.push({ path, line, mode: 'folder-relative', sectionRoot });
        }
      }
    }
  });
  return refs;
}

describe('AGENTS.md names only paths that exist', () => {
  it('resolves every path in the text and the repo layout', () => {
    const allFiles = listRepoFiles();
    const missing: string[] = [];
    for (const ref of extractReferences()) {
      if (ALLOWLIST.some((a) => a.name === basename(ref.path))) continue;
      const where = `AGENTS.md:${String(ref.line)}: ${ref.path}`;
      if (ref.mode === 'exact') {
        if (!existsSync(join(repoRoot, ref.path))) missing.push(where);
        continue;
      }
      const root = ref.sectionRoot ?? '';
      if (ref.mode === 'bare') {
        const found = allFiles.some(
          (f) => f.startsWith(`${root}/`) && basename(f) === ref.path,
        );
        if (!found)
          missing.push(`${where} (no file of that name under ${root})`);
        continue;
      }
      // A path such as `webview/pack-registry.ts`, relative to the package or its src folder.
      const candidates = [join(root, ref.path), join(root, 'src', ref.path)];
      const parentExists = candidates.some((c) =>
        existsSync(join(repoRoot, c, '..')),
      );
      if (
        parentExists &&
        !candidates.some((c) => existsSync(join(repoRoot, c)))
      ) {
        missing.push(`${where} (not under ${root})`);
      }
    }
    expect(
      missing,
      `AGENTS.md names paths that do not exist. Correct the path to where the file lives, or delete the clause. A generated file goes in ALLOWLIST in guards/agents-paths.test.ts with the reason "generated".\n${missing.join('\n')}`,
    ).toEqual([]);
  });
});
