// The extension's discoverability is almost entirely DECLARATIVE — an
// editor-title button and a keybinding, both defined in `package.json`'s
// `contributes` and neither reachable from any TypeScript this repo can run.
// These tests treat that block as the data it is (the same approach
// `grammar.test.ts` takes to the injection grammar) and pin the parts a
// careless edit would silently break:
//
//   - the title-bar button's explicit `navigation@1` priority. VS Code's own
//     markdown preview button uses the SAME `$(open-preview)` codicon, so
//     without a fixed position the two are indistinguishable AND can reorder
//     or overflow into the `...` menu between sessions — which is exactly how
//     the first real user failed to find this command at all.
//   - the Ctrl+Shift+V / Cmd+Shift+V keybinding and, above all, the scope of
//     its `when` clause: it must fire on `.mk.md` documents and must NOT fire
//     on a plain `.md` one, where VS Code's built-in markdown preview keeps
//     that shortcut. The test compiles the regex out of the `when` clause and
//     runs real file names through it, rather than merely asserting the
//     clause's text.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGE_JSON_PATH = resolve(import.meta.dirname, '../package.json');

const COMMAND = 'markii.openPreview';

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} is not an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${what} is not an array`);
  return value;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`${what} is not a string`);
  return value;
}

const packageJson: unknown = JSON.parse(
  readFileSync(PACKAGE_JSON_PATH, 'utf8'),
);
const contributes = asRecord(
  asRecord(packageJson, 'package.json').contributes,
  'package.json.contributes',
);

/** The one `editor/title` menu entry for the preview command. */
function editorTitleEntry(): Record<string, unknown> {
  const menus = asRecord(contributes.menus, 'contributes.menus');
  const entries = asArray(menus['editor/title'], 'menus["editor/title"]');
  const found = entries
    .map((entry) => asRecord(entry, 'menus["editor/title"][]'))
    .filter((entry) => entry.command === COMMAND);
  expect(found).toHaveLength(1);
  return found[0] as Record<string, unknown>;
}

/** The one keybinding entry for the preview command. */
function keybindingEntry(): Record<string, unknown> {
  const entries = asArray(
    contributes.keybindings,
    'contributes.keybindings',
  ).map((entry) => asRecord(entry, 'contributes.keybindings[]'));
  const found = entries.filter((entry) => entry.command === COMMAND);
  expect(found).toHaveLength(1);
  return found[0] as Record<string, unknown>;
}

/**
 * Pulls the `resourceFilename =~ /.../` regex out of a `when` clause and
 * compiles it — so a test can check which file names the clause actually
 * selects, not just how it is spelled.
 */
function resourceFilenamePattern(when: string): RegExp {
  const match = /resourceFilename\s*=~\s*\/(.+?)\/(?=\s|$|\))/.exec(when);
  if (!match?.[1]) {
    throw new Error(`no resourceFilename regex in when clause: ${when}`);
  }
  // The clause lives in JSON, where each backslash is already unescaped by
  // `JSON.parse` — what `match[1]` holds is the literal regex source VS Code
  // compiles.
  return new RegExp(match[1]);
}

describe('contributes.menus — editor title button', () => {
  it('has an explicit navigation priority so it cannot drift or overflow', () => {
    expect(editorTitleEntry().group).toBe('navigation@1');
  });

  it('is scoped to .mk.md files', () => {
    const pattern = resourceFilenamePattern(
      asString(editorTitleEntry().when, 'menu entry when'),
    );
    expect(pattern.test('notes.mk.md')).toBe(true);
    expect(pattern.test('notes.md')).toBe(false);
  });
});

describe('contributes.menus — explorer context (bundle preview)', () => {
  it('offers the preview command for .mkz and .mkbundle resources, but not plain .mk.md', () => {
    const menus = asRecord(contributes.menus, 'contributes.menus');
    const entries = asArray(
      menus['explorer/context'],
      'menus["explorer/context"]',
    )
      .map((entry) => asRecord(entry, 'menus["explorer/context"][]'))
      .filter((entry) => entry.command === COMMAND);
    expect(entries).toHaveLength(1);

    const when = asString(entries[0]?.when, 'explorer/context entry when');
    const match = /resourceFilename\s*=~\s*\/(.+?)\/i(?=\s|$|\))/.exec(when);
    expect(match).not.toBeNull();
    const pattern = new RegExp(match?.[1] ?? '', 'i');

    expect(pattern.test('note.mkz')).toBe(true);
    expect(pattern.test('note.MKZ')).toBe(true);
    expect(pattern.test('note.mkbundle')).toBe(true);
    expect(pattern.test('note.mk.md')).toBe(false);
    expect(pattern.test('note.zip')).toBe(false);
  });
});

describe('contributes.keybindings — Ctrl+Shift+V', () => {
  it('binds ctrl+shift+v, with cmd+shift+v on macOS', () => {
    const entry = keybindingEntry();
    expect(entry.key).toBe('ctrl+shift+v');
    expect(entry.mac).toBe('cmd+shift+v');
  });

  it('requires editor text focus, so it cannot hijack the terminal or other views', () => {
    const when = asString(keybindingEntry().when, 'keybinding when');
    expect(when).toContain('editorTextFocus');
  });

  it('fires for .mk.md documents only — a plain .md keeps the built-in markdown preview', () => {
    const pattern = resourceFilenamePattern(
      asString(keybindingEntry().when, 'keybinding when'),
    );
    expect(pattern.test('notes.mk.md')).toBe(true);
    expect(pattern.test('deep/path/notes.mk.md')).toBe(true);
    expect(pattern.test('notes.md')).toBe(false);
    expect(pattern.test('readme.md')).toBe(false);
    // Not merely "contains .mk.md": the extension must be at the END.
    expect(pattern.test('notes.mk.md.txt')).toBe(false);
    expect(pattern.test('notes.mk.markdown')).toBe(false);
  });

  it('names the command this extension actually registers', () => {
    const commands = asArray(contributes.commands, 'contributes.commands').map(
      (entry) => asRecord(entry, 'contributes.commands[]').command,
    );
    expect(commands).toContain(COMMAND);
  });
});
