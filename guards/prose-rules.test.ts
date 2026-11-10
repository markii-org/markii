// The sentence rules in AGENTS.md ("Documentation style") for docs and
// READMEs, held by a check. CHANGELOG.md is release notes and is not scanned
// for hashes, issue numbers or dates.
import { describe, expect, it } from 'vitest';
import {
  formatViolations,
  listRepoFiles,
  readRepoFile,
  type Violation,
} from './repo-files.ts';

const SCANNED_PROSE = [
  /^docs\/(?!archive\/).+\.md$/,
  /^README\.md$/,
  /^packages\/[^/]+\/README\.md$/,
  /^packages\/platforms\/[^/]+\/README\.md$/,
  /^apps\/[^/]+\/README\.md$/,
  /^e2e\/.*README\.md$/,
  // Text the VS Code extension ships as its getting-started walkthrough.
  /^apps\/vscode\/walkthrough\/[^/]+\.md$/,
];

const BANNED_WORDS = [
  'crucial',
  'delve',
  'pivotal',
  'showcase',
  'tapestry',
  'testament',
  'underscore',
  'vibrant',
  'landscape',
  'robust',
  'leverage',
  'seamless',
  'comprehensive',
];
const BANNED_WORD = new RegExp(`\\b(?:${BANNED_WORDS.join('|')})\\b`, 'i');

// "underscore" is allowed where it names the character: the same line
// shows the literal `_`, or the phrase around the word reads as the character
// ("an underscore", "underscore character").
const UNDERSCORE_AS_CHARACTER =
  /`_`|\b(?:an?|the|leading|trailing|single|double|one|each|any|no)\s+underscores?\b|\bunderscores?\s+(?:character|char|and|or|in|between|replac|separat|join)|`[^`]*`\s*underscores?\b|\bunderscores?\s*\(/i;

const EM_DASH = String.fromCharCode(0x2014);
const MACHINE_PATH =
  /(?<![.\w])(?:\/home\/|\/Users\/)(?!(?:u|user|me|ana|al|username)(?![\w.-]))[A-Za-z][\w.-]*/;
const SCRATCH_PATH = /(?<![\w./~-])tmp\/[\w.*-]/;
const CHAT_LINK = /claude\.ai\/|Claude-Session/;
const DATE = /\b20\d\d-\d\d-\d\d\b/;
const ISSUE_REFERENCE = /(?<![\w&])#\d+\b|\bissues? \d+\b/i;

/** A 7 to 40 character hex token holding at least one digit and one letter a-f. */
function findCommitHash(text: string): string | undefined {
  for (const match of text.matchAll(/\b[0-9a-f]{7,40}\b/gi)) {
    const token = match[0];
    if (/[0-9]/.test(token) && /[a-f]/i.test(token)) return token;
  }
  return undefined;
}

/** The record docs/security.md keeps of audits. It is the one place a month or date may appear. */
const VERIFICATION_HEADING = /^## Verification status\b/;

/** A known hit that stays: file, exact substring, and why. */
const ALLOWLIST: { file: string; substring: string; reason: string }[] = [];

function isAllowed(file: string, text: string): boolean {
  return ALLOWLIST.some(
    (entry) => entry.file === file && text.includes(entry.substring),
  );
}

describe('docs and READMEs follow the sentence rules', () => {
  it('has no em dash, banned word, machine path, scratch reference, chat link, hash, issue number or date', () => {
    const violations: Violation[] = [];
    for (const file of listRepoFiles()) {
      if (!SCANNED_PROSE.some((p) => p.test(file))) continue;
      const inDocs = file.startsWith('docs/');
      const lines = readRepoFile(file).split('\n');
      let fence: string | undefined;
      let inVerification = false;
      lines.forEach((text, index) => {
        const report = (rule: string): void => {
          if (isAllowed(file, text)) return;
          violations.push({ file, line: index + 1, rule, text });
        };
        const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(text);
        if (fenceMatch) {
          const marker = fenceMatch[1] ?? '';
          if (fence === undefined) fence = marker;
          else if (
            marker.startsWith(fence[0] ?? '') &&
            marker.length >= fence.length
          )
            fence = undefined;
        }
        const inFence = fence !== undefined || fenceMatch !== null;
        if (fence === undefined && /^## /.test(text)) {
          inVerification =
            file === 'docs/security.md' && VERIFICATION_HEADING.test(text);
        }

        if (text.includes(EM_DASH)) {
          report(
            'em dash: use a colon, a comma, a parenthetical or a new sentence',
          );
        }
        if (MACHINE_PATH.test(text)) {
          report(
            'machine path: use a repository-relative path or a placeholder',
          );
        }
        if (SCRATCH_PATH.test(text)) {
          report(
            'scratch file reference: state the fact, not where it came from',
          );
        }
        if (CHAT_LINK.test(text)) {
          report('chat or session link: remove it');
        }
        if (!inVerification && DATE.test(text)) {
          report(
            'date: dates live in CHANGELOG.md (docs/security.md keeps a month in its verification record)',
          );
        }
        if (inFence) return;
        const word = BANNED_WORD.exec(text);
        if (
          word &&
          !(
            word[0].toLowerCase() === 'underscore' &&
            UNDERSCORE_AS_CHARACTER.test(text)
          )
        ) {
          report(`banned word "${word[0]}": use a plain word or delete it`);
        }
        if (inDocs) {
          const hash = findCommitHash(text);
          if (hash) {
            report(
              `commit hash "${hash}": docs state rules, history lives in git`,
            );
          }
          if (ISSUE_REFERENCE.test(text)) {
            report(
              'issue reference: issue numbers belong in CHANGELOG.md and commit messages',
            );
          }
        }
      });
    }
    expect(
      violations,
      `Sentence-rule violations:\n${formatViolations(violations)}`,
    ).toEqual([]);
  });
});
