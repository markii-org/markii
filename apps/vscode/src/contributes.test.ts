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

describe('contributes — the two export commands (#28, #36)', () => {
  // Both export commands are reachable only through `contributes`: the
  // palette entry, and the editor-title group the single export already
  // sits in. A cascade export writes a whole archive of files, so the two
  // must stay side by side and stay scoped the same way; an edit that
  // dropped either declaration would make the command invisible with
  // nothing else failing.
  function commandTitle(command: string): string {
    const commands = asArray(contributes.commands, 'contributes.commands')
      .map((entry) => asRecord(entry, 'contributes.commands[]'))
      .filter((entry) => entry.command === command);
    expect(commands).toHaveLength(1);
    return asString(commands[0]?.title, `${command} title`);
  }

  function menuEntry(menu: string, command: string): Record<string, unknown> {
    const menus = asRecord(contributes.menus, 'contributes.menus');
    const entries = asArray(menus[menu], `menus[${JSON.stringify(menu)}]`)
      .map((entry) => asRecord(entry, `menus[${JSON.stringify(menu)}][]`))
      .filter((entry) => entry.command === command);
    expect(entries).toHaveLength(1);
    return entries[0] as Record<string, unknown>;
  }

  it('declares both commands under the Markii category', () => {
    expect(commandTitle('markii.exportHtml')).toBe('Export as HTML…');
    expect(commandTitle('markii.exportHtmlCascade')).toBe(
      'Export as HTML cascade…',
    );
  });

  it('puts the cascade command beside the single export in the editor title menu, with the same scope', () => {
    const single = menuEntry('editor/title', 'markii.exportHtml');
    const cascade = menuEntry('editor/title', 'markii.exportHtmlCascade');
    expect(single.group).toBe('1_markii@1');
    expect(cascade.group).toBe('1_markii@2');
    expect(cascade.when).toBe(single.when);

    const pattern = resourceFilenamePattern(
      asString(cascade.when, 'cascade menu entry when'),
    );
    expect(pattern.test('notes.mk.md')).toBe(true);
    expect(pattern.test('notes.md')).toBe(false);
  });

  it('offers both in the command palette on the same condition', () => {
    const single = menuEntry('commandPalette', 'markii.exportHtml');
    const cascade = menuEntry('commandPalette', 'markii.exportHtmlCascade');
    expect(cascade.when).toBe(single.when);
    expect(cascade.when).toBe('editorLangId == markii || markii.previewActive');
  });
});

describe('contributes.configuration — markii.packs application scope (H-1)', () => {
  // H-1 (pass-3 pentest report, section 10.2): `markii.packs` being
  // USER-scope only is the entire reason a malicious repo's
  // `.vscode/settings.json` cannot silently inject a pack folder — every doc
  // comment and the setting's own description promise this, but the actual
  // mechanism is one string in package.json. Removing or changing it would
  // re-enable workspace-settings pack injection while every comment still
  // claimed otherwise, with nothing else catching it. This pins it, the same
  // pin-the-declarative-block pattern the menu/keybinding tests above use.
  function packsProperty(): Record<string, unknown> {
    const configuration = asRecord(
      contributes.configuration,
      'contributes.configuration',
    );
    const properties = asRecord(
      configuration.properties,
      'contributes.configuration.properties',
    );
    return asRecord(properties['markii.packs'], 'properties["markii.packs"]');
  }

  it('declares markii.packs as application scope (user settings only)', () => {
    expect(packsProperty().scope).toBe('application');
  });

  it('defaults markii.packs to an empty list', () => {
    expect(packsProperty().default).toEqual([]);
  });
});

describe('contributes.configuration — run-on-open / scheduled refresh (#11)', () => {
  function property(name: string): Record<string, unknown> {
    const configuration = asRecord(
      contributes.configuration,
      'contributes.configuration',
    );
    const properties = asRecord(
      configuration.properties,
      'contributes.configuration.properties',
    );
    return asRecord(properties[name], `properties[${JSON.stringify(name)}]`);
  }

  it('markii.runOnOpen is a boolean defaulting off', () => {
    const runOnOpen = property('markii.runOnOpen');
    expect(runOnOpen.type).toBe('boolean');
    expect(runOnOpen.default).toBe(false);
  });

  it('markii.refreshIntervalSeconds is a number defaulting to 0 (off)', () => {
    const refresh = property('markii.refreshIntervalSeconds');
    expect(refresh.type).toBe('number');
    expect(refresh.default).toBe(0);
    expect(refresh.minimum).toBe(0);
  });
});

describe('contributes — the two script knobs (#34)', () => {
  function property(name: string): Record<string, unknown> {
    const configuration = asRecord(
      contributes.configuration,
      'contributes.configuration',
    );
    const properties = asRecord(
      configuration.properties,
      'contributes.configuration.properties',
    );
    return asRecord(properties[name], `properties[${JSON.stringify(name)}]`);
  }

  it('markii.hideScriptBlocks is a boolean defaulting off, so today renders unchanged', () => {
    const setting = property('markii.hideScriptBlocks');
    expect(setting.type).toBe('boolean');
    expect(setting.default).toBe(false);
  });

  it('markii.scriptsDisabled is a boolean defaulting off, so scripting works as before until asked otherwise', () => {
    const setting = property('markii.scriptsDisabled');
    expect(setting.type).toBe('boolean');
    expect(setting.default).toBe(false);
  });

  it('declares the toggle command, in the Markii category and in the palette', () => {
    const commands = asArray(contributes.commands, 'contributes.commands').map(
      (entry) => asRecord(entry, 'contributes.commands[]'),
    );
    const toggle = commands.filter(
      (entry) => entry.command === 'markii.toggleScriptExecution',
    );
    expect(toggle).toHaveLength(1);
    expect(toggle[0]?.category).toBe('Markii');
    expect(toggle[0]?.title).toBe('Toggle Script Execution');

    const menus = asRecord(contributes.menus, 'contributes.menus');
    const palette = asArray(menus.commandPalette, 'menus.commandPalette').map(
      (entry) => asRecord(entry, 'menus.commandPalette[]'),
    );
    expect(
      palette.some((entry) => entry.command === 'markii.toggleScriptExecution'),
    ).toBe(true);
  });

  it('mirrors the existing toggle: same category, same unconditional palette entry as markii.toggleRunOnOpen', () => {
    const menus = asRecord(contributes.menus, 'contributes.menus');
    const palette = asArray(menus.commandPalette, 'menus.commandPalette').map(
      (entry) => asRecord(entry, 'menus.commandPalette[]'),
    );
    const runOnOpen = palette.find(
      (entry) => entry.command === 'markii.toggleRunOnOpen',
    );
    const scripts = palette.find(
      (entry) => entry.command === 'markii.toggleScriptExecution',
    );
    expect(Object.keys(runOnOpen ?? {})).toEqual(Object.keys(scripts ?? {}));
  });
});

describe('contributes.configuration — markii.allowPrivateNetworkAddresses application scope (#10)', () => {
  // Same reasoning as `markii.packs`' H-1 pin above, applied to the
  // network-widening setting GitHub issue #10 adds: `allowPrivateNetworkAddresses`
  // lifts the refusal a granted host's resolved address would otherwise get
  // when it lands in a loopback/private/link-local range (DNS rebinding /
  // SSRF against the user's own machine or LAN). It is not an
  // unattended-execution setting — see
  // `contributes-runopen-scope.probe.test.ts`'s own list for that category —
  // but the same workspace-injection concern applies to widening what a
  // note's granted network access can reach: a repo's own
  // `.vscode/settings.json` must not be able to flip it on for whoever opens
  // that repo.
  function property(name: string): Record<string, unknown> {
    const configuration = asRecord(
      contributes.configuration,
      'contributes.configuration',
    );
    const properties = asRecord(
      configuration.properties,
      'contributes.configuration.properties',
    );
    return asRecord(properties[name], `properties[${JSON.stringify(name)}]`);
  }

  it('is a boolean defaulting off', () => {
    const setting = property('markii.allowPrivateNetworkAddresses');
    expect(setting.type).toBe('boolean');
    expect(setting.default).toBe(false);
  });

  it('is pinned to application scope, so a workspace cannot widen network access on the reader behalf', () => {
    expect(
      Object.hasOwn(property('markii.allowPrivateNetworkAddresses'), 'scope'),
    ).toBe(true);
    expect(property('markii.allowPrivateNetworkAddresses').scope).toBe(
      'application',
    );
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
