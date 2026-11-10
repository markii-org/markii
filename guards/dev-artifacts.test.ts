// Source files state rules and facts. They never point at private scratch
// files, work rounds, developer machines or chat sessions. See AGENTS.md,
// "No development artifacts in anything committed".
import { describe, expect, it } from 'vitest';
import {
  formatViolations,
  listRepoFiles,
  readRepoFile,
  type Violation,
} from './repo-files.ts';

const SCANNED_DIRECTORIES = [
  /^packages\/[^/]+\/src\//,
  /^packages\/platforms\/[^/]+\/src\//,
  /^apps\/[^/]+\/src\//,
  /^packs\//,
  /^e2e\/browser-host\/(src|tests|node-tests|scripts)\//,
  /(^|\/)esbuild[^/]*\.mjs$/,
  /(^|\/)scripts\/[^/]+\.(mjs|ts)$/,
];
const SCANNED_EXTENSIONS = /\.(ts|tsx|mjs|js|lua|css)$/;
const SKIPPED = [/\.generated\./, /\.min\./, /\.d\.ts$/];

// The pattern list lives in this file, so this file is not scanned.
const SELF = 'guards/dev-artifacts.test.ts';

// Account names that are plainly fixture data for path logic, not a person.
const PLACEHOLDER_ACCOUNTS = [
  'u',
  'user',
  'me',
  'ana',
  'al',
  'etc',
  'username',
];

interface Rule {
  name: string;
  pattern: RegExp;
  fix: string;
}

const RULES: Rule[] = [
  {
    name: 'private scratch file reference',
    pattern: /(?<![\w./~-])tmp\/(?:[A-Z]|W\d)/,
    fix: 'state the rule in present tense instead of pointing at a scratch file',
  },
  {
    name: 'work-round vocabulary',
    pattern:
      /\bbatch \d|\bPhase \d|survey (?:finding|section)|\bBRIEF\b|\bW1\d\b|worker report\b|orchestrator decision|adversarial finding|pentest finding|SPIKE-\d|never published/,
    fix: 'describe the behavior, not the round of work that produced it',
  },
  {
    name: 'developer machine path',
    pattern: new RegExp(
      `(?<![.\\w])(?:/home/|/Users/|[cC]:\\\\+Users\\\\+|/[cC]:/Users/)(?!(?:${PLACEHOLDER_ACCOUNTS.join('|')})(?![\\w.-]))[A-Za-z][\\w.-]*`,
    ),
    fix: 'use a repository-relative path or a placeholder',
  },
  {
    name: 'chat or session link',
    pattern: /claude\.ai\/|Claude-Session/,
    fix: 'remove the link; a committed file never points back at a conversation',
  },
];

/** A legitimate hit: the file, the exact substring, and why it stays. */
const ALLOWLIST: { file: string; substring: string; reason: string }[] = [];

describe('no development artifacts in source', () => {
  it('finds none of the banned references', () => {
    const violations: Violation[] = [];
    for (const file of listRepoFiles()) {
      if (file === SELF) continue;
      if (!SCANNED_EXTENSIONS.test(file)) continue;
      if (SKIPPED.some((p) => p.test(file))) continue;
      if (!SCANNED_DIRECTORIES.some((p) => p.test(file))) continue;
      const lines = readRepoFile(file).split('\n');
      lines.forEach((text, index) => {
        for (const rule of RULES) {
          if (!rule.pattern.test(text)) continue;
          const allowed = ALLOWLIST.some(
            (entry) => entry.file === file && text.includes(entry.substring),
          );
          if (allowed) continue;
          violations.push({
            file,
            line: index + 1,
            rule: `${rule.name}: ${rule.fix}`,
            text,
          });
        }
      });
    }
    expect(
      violations,
      `Development artifacts found:\n${formatViolations(violations)}`,
    ).toEqual([]);
  });
});
