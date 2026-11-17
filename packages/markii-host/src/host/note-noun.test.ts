// The note noun a host chooses reaches every prompt and notice sentence.
// The sentences live in one template each, so a template that names the
// note by a literal word would ignore `HostLabels.noteNoun`. The scan below
// holds that, and the sentence tests prove each template takes the label.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { HostLabels } from './adapter.js';
import {
  buildCascadeArchive,
  cascadeDiagnosticLines,
  cascadeResultMessage,
} from './cascade-export-behavior.js';
import {
  exportDiagnosticLines,
  exportResultMessage,
  renderEngineDiagnosticLine,
} from './export-behavior.js';
import { CLI_LABELS } from './labels.fixture.js';
import { DEFAULT_NOTE_NOUN, noteNounOf } from './labels.js';
import { promptsFromAdapter } from './run-behavior.js';
import {
  scheduledRefreshNotStartedLine,
  scriptsDisabledConfirmationText,
  scriptsDisabledDiagnosticLine,
  scriptsDisabledNoticeText,
  scriptsEnabledConfirmationText,
} from './script-execution.js';
import {
  terminalScriptMissingLine,
  terminalScriptNamespaceMismatchLine,
  terminalScriptRejectedLine,
  terminalScriptUnreadableLine,
} from './terminal-packs.js';
import { runGrantFlow } from '../run/grant-flow.js';
import type { HtmlExportEngine } from '../export/note-export.js';
import { EMPTY_IMAGE_REPORT } from '../export/image-embed.js';
import type { HostAdapter, HostPromptRequest } from './adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');

const PAGE_LABELS: HostLabels = { ...CLI_LABELS, noteNoun: 'page' };

/** Whole-word "note" or "notes" in any case. */
const NOTE_WORD = /\bnotes?\b/i;

describe('noteNounOf', () => {
  it('defaults to note and reads the label otherwise', () => {
    expect(noteNounOf()).toBe(DEFAULT_NOTE_NOUN);
    expect(noteNounOf({})).toBe('note');
    expect(noteNounOf({ noteNoun: '  ' })).toBe('note');
    expect(noteNounOf({ noteNoun: 'page' })).toBe('page');
  });
});

describe('every prompt and notice template follows the host note noun', () => {
  it('scans no string in src/host or src/run that names the note by a literal word', () => {
    // Scope: every non-test `.ts` file under src/host and src/run. A string
    // literal or template piece counts, and so does an identifier-free
    // template head. Module specifiers are skipped. So are the corpus file
    // name `note.mk.md` (a path, not a sentence), the label fixtures (they
    // are label VALUES) and the one default noun literal in labels.ts.
    const offenders: string[] = [];
    for (const file of sourceFiles(join(srcRoot, 'host')).concat(
      sourceFiles(join(srcRoot, 'run')),
    )) {
      const name = relative(srcRoot, file);
      if (name === join('host', 'labels.fixture.ts')) continue;
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isImportDeclaration(node) ||
          ts.isExportDeclaration(node) ||
          ts.isImportTypeNode(node)
        ) {
          return;
        }
        let text: string | undefined;
        if (ts.isStringLiteralLike(node)) text = node.text;
        else if (
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)
        ) {
          text = node.text;
        }
        if (text !== undefined && NOTE_WORD.test(text)) {
          const isPath = text.includes('.mk.md');
          const isDefault =
            name === join('host', 'labels.ts') && text === 'note';
          if (!isPath && !isDefault) {
            const { line } = source.getLineAndCharacterOfPosition(
              node.getStart(),
            );
            offenders.push(`${name}:${String(line + 1)}: ${text.slice(0, 80)}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(offenders).toEqual([]);
  });

  const sentences: Array<[string, () => string]> = [
    ['scriptsDisabledNoticeText', () => scriptsDisabledNoticeText(PAGE_LABELS)],
    [
      'scriptsDisabledConfirmationText',
      () => scriptsDisabledConfirmationText(PAGE_LABELS),
    ],
    [
      'scriptsEnabledConfirmationText',
      () => scriptsEnabledConfirmationText(PAGE_LABELS),
    ],
    [
      'exportResultMessage (failed)',
      () => exportResultMessage({ kind: 'failed', reason: 'x' }, PAGE_LABELS),
    ],
    [
      'exportResultMessage (no stored values)',
      () =>
        exportResultMessage(
          {
            kind: 'exported',
            path: '/a/b.html',
            bytes: 1,
            valueCount: 0,
            hasScripts: true,
            render: { engine: 'static', reason: 'no-packs' },
            images: EMPTY_IMAGE_REPORT,
          },
          PAGE_LABELS,
        ),
    ],
    [
      'renderEngineDiagnosticLine (no-renderer)',
      () =>
        renderEngineDiagnosticLine(
          { engine: 'static', reason: 'no-renderer' },
          PAGE_LABELS,
        ),
    ],
    [
      'renderEngineDiagnosticLine (render-failed)',
      () =>
        renderEngineDiagnosticLine(
          { engine: 'static', reason: 'render-failed' },
          PAGE_LABELS,
        ),
    ],
    [
      'exportDiagnosticLines',
      () =>
        exportDiagnosticLines(
          {
            kind: 'written',
            path: '/a/b.html',
            bytes: 1,
            valueCount: 0,
            render: { engine: 'static', reason: 'no-renderer' },
            images: EMPTY_IMAGE_REPORT,
          },
          PAGE_LABELS,
        ).join('\n'),
    ],
    [
      'cascadeResultMessage (partial)',
      () =>
        cascadeResultMessage(
          {
            kind: 'exported',
            path: '/a/b.zip',
            bytes: 1,
            notes: [],
            unreadable: [{ path: '/x', from: '/y' }],
          },
          PAGE_LABELS,
        ),
    ],
    [
      'cascadeDiagnosticLines (depth)',
      () =>
        cascadeDiagnosticLines(
          {
            kind: 'exported',
            path: '/a/b.zip',
            bytes: 1,
            notes: [],
            unreadable: [],
            truncated: 'depth',
          },
          PAGE_LABELS,
        ).join('\n'),
    ],
    [
      'cascadeDiagnosticLines (count)',
      () =>
        cascadeDiagnosticLines(
          {
            kind: 'exported',
            path: '/a/b.zip',
            bytes: 1,
            notes: [
              {
                path: '/a.md',
                entryName: 'a.html',
                valueCount: 0,
                render: { engine: 'static', reason: 'no-renderer' },
                images: EMPTY_IMAGE_REPORT,
              },
            ],
            unreadable: [],
            truncated: 'count',
          },
          PAGE_LABELS,
        ).join('\n'),
    ],
    [
      'terminal pack lines',
      () =>
        [
          terminalScriptMissingLine('p', PAGE_LABELS),
          terminalScriptUnreadableLine('p', 'why', PAGE_LABELS),
          terminalScriptRejectedLine('p', 'why', PAGE_LABELS),
          terminalScriptNamespaceMismatchLine('p', 'q', PAGE_LABELS),
        ].join('\n'),
    ],
  ];

  for (const [name, build] of sentences) {
    it(`${name} says page and never note`, () => {
      const text = build();
      expect(text).toMatch(/\bpages?\b/);
      expect(text).not.toMatch(NOTE_WORD);
    });
  }

  it('the cascade failure reason says page and never note', async () => {
    const result = await buildCascadeArchive({
      engine: {} as unknown as HtmlExportEngine,
      rootPath: '/root.md',
      readNote: () => Promise.resolve(undefined),
      resolveLink: () => undefined,
      readValues: () => ({}),
      noteNoun: 'page',
    });
    expect(result).toEqual({
      kind: 'failed',
      reason: 'could not read the root page /root.md',
    });
  });

  it('the diagnostics lines that carry no note word stay as they were', () => {
    expect(scheduledRefreshNotStartedLine(PAGE_LABELS)).not.toMatch(NOTE_WORD);
    expect(scriptsDisabledDiagnosticLine('manual', PAGE_LABELS)).not.toMatch(
      NOTE_WORD,
    );
  });

  it('every grant prompt says page and never note', async () => {
    const seen: HostPromptRequest[] = [];
    const adapter = {
      labels: PAGE_LABELS,
      prompt: (request: HostPromptRequest) => {
        seen.push(request);
        return Promise.resolve(true);
      },
    } as unknown as HostAdapter;
    const prompts = promptsFromAdapter(adapter);
    await prompts.promptHost('a.example.com', ['b.example.com']);
    await prompts.promptUnknownHosts(['a.example.com']);
    await prompts.promptManyHosts(['a.example.com']);
    expect(seen).toHaveLength(3);
    for (const request of seen) {
      expect(request.message).toMatch(/\bpage/);
      expect(request.message).not.toMatch(NOTE_WORD);
    }
    expect(seen[0]?.message).toBe(
      "This page's scripts can send data to a.example.com. The page declares b.example.com. Allow?",
    );
  });
});

describe('the prompt fields are the hosts the message names', () => {
  /** Drives the real grant flow through `promptsFromAdapter` and records each request. */
  async function askFor(
    hosts: string[],
    options: { declared?: string[]; unknown?: boolean },
  ): Promise<HostPromptRequest[]> {
    const seen: HostPromptRequest[] = [];
    const adapter = {
      labels: CLI_LABELS,
      prompt: (request: HostPromptRequest) => {
        seen.push(request);
        return Promise.resolve(true);
      },
    } as unknown as HostAdapter;
    const store = new Map<string, unknown>();
    await runGrantFlow({
      documentKey: 'doc',
      requirements: {
        hosts,
        hasUnknownHosts: options.unknown === true,
        grantScripts: [{ name: 'a', lang: 'lua', code: 'return 1' }],
      },
      memento: {
        get: <T>(key: string, fallback?: T): T =>
          (store.has(key) ? store.get(key) : fallback) as T,
        update: (key: string, value: unknown) => {
          store.set(key, value);
          return Promise.resolve();
        },
      },
      declaredHosts: options.declared ?? [],
      ...promptsFromAdapter(adapter),
    });
    return seen;
  }

  it('grant-host carries the normalized host and declared hosts, and the message names them', async () => {
    const [request] = await askFor(['Api.Example.com'], {
      declared: ['API.Example.com.', 'Other.Example.com'],
    });
    expect(request?.kind).toBe('grant-host');
    if (request?.kind !== 'grant-host') throw new Error('wrong kind');
    expect(request.host).toBe('api.example.com');
    expect(request.declaredHosts).toEqual([
      'api.example.com',
      'other.example.com',
    ]);
    expect(request.message).toBe(
      "This note's scripts can send data to api.example.com. The note declares api.example.com, other.example.com. Allow?",
    );
  });

  it('grant-host carries an empty declared list when the note declares none', async () => {
    const [request] = await askFor(['a.example.com'], {});
    if (request?.kind !== 'grant-host') throw new Error('wrong kind');
    expect(request.declaredHosts).toEqual([]);
    expect(request.message).toBe(
      "This note's scripts can send data to a.example.com. Allow?",
    );
  });

  it('grant-unknown-hosts carries the lower-cased hosts a decline withdraws', async () => {
    const seen = await askFor(['A.example.com'], { unknown: true });
    const request = seen.find((r) => r.kind === 'grant-unknown-hosts');
    if (request?.kind !== 'grant-unknown-hosts') throw new Error('missing');
    expect(request.hosts).toEqual(['a.example.com']);
  });

  it('grant-many-hosts carries every lower-cased host and the message names their count', async () => {
    const hosts = Array.from(
      { length: 12 },
      (_, i) => `H${String(i)}.Example.com`,
    );
    const [request] = await askFor(hosts, {});
    if (request?.kind !== 'grant-many-hosts') throw new Error('wrong kind');
    expect(request.hosts).toEqual(hosts.map((h) => h.toLowerCase()));
    expect(request.message).toContain('(12)');
  });
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (
      entry.name.endsWith('.ts') &&
      !entry.name.includes('.test.') &&
      !entry.name.includes('.probe.')
    ) {
      out.push(full);
    }
  }
  return out;
}
