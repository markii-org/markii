import { describe, expect, it } from 'vitest';
import {
  isCascadeNoteTarget,
  resolveNoteRelativeLink,
} from './cascade-links.js';

describe('isCascadeNoteTarget', () => {
  it('accepts a markdown note, plain or Markii', () => {
    expect(isCascadeNoteTarget('other.md')).toBe(true);
    expect(isCascadeNoteTarget('other.mk.md')).toBe(true);
    expect(isCascadeNoteTarget('sub/Other.MD')).toBe(true);
  });

  it('rejects anything that is not a note', () => {
    expect(isCascadeNoteTarget('nice.png')).toBe(false);
    expect(isCascadeNoteTarget('report.pdf')).toBe(false);
    expect(isCascadeNoteTarget('other')).toBe(false);
    expect(isCascadeNoteTarget('.md')).toBe(false);
  });
});

describe('resolveNoteRelativeLink', () => {
  it('resolves a sibling note against the linking note folder', () => {
    expect(
      resolveNoteRelativeLink('/vault/notes/index.mk.md', 'other.mk.md'),
    ).toBe('/vault/notes/other.mk.md');
  });

  it('resolves into a subfolder', () => {
    expect(
      resolveNoteRelativeLink('/vault/notes/index.mk.md', 'sub/deeper.md'),
    ).toBe('/vault/notes/sub/deeper.md');
  });

  it('resolves an explicit ./ prefix', () => {
    expect(
      resolveNoteRelativeLink('/vault/notes/index.mk.md', './other.mk.md'),
    ).toBe('/vault/notes/other.mk.md');
  });

  it('resolves .. into a parent folder', () => {
    expect(
      resolveNoteRelativeLink('/vault/notes/sub/deep.mk.md', '../other.mk.md'),
    ).toBe('/vault/notes/other.mk.md');
  });

  it('collapses a path that climbs and descends again', () => {
    expect(
      resolveNoteRelativeLink('/vault/a/index.mk.md', '../b/../a/other.mk.md'),
    ).toBe('/vault/a/other.mk.md');
  });

  it('refuses a target that climbs above the root', () => {
    expect(
      resolveNoteRelativeLink('/vault/index.mk.md', '../../etc/notes.md'),
    ).toBeUndefined();
  });

  it('refuses an absolute target', () => {
    expect(
      resolveNoteRelativeLink('/vault/index.mk.md', '/etc/secret.md'),
    ).toBeUndefined();
  });

  it('refuses a folder target and an empty target', () => {
    expect(
      resolveNoteRelativeLink('/vault/index.mk.md', 'sub/'),
    ).toBeUndefined();
    expect(resolveNoteRelativeLink('/vault/index.mk.md', '')).toBeUndefined();
  });

  it('refuses a target that is not a note', () => {
    expect(
      resolveNoteRelativeLink('/vault/index.mk.md', 'assets/nice.png'),
    ).toBeUndefined();
    expect(
      resolveNoteRelativeLink('/vault/index.mk.md', 'other'),
    ).toBeUndefined();
  });

  it('keeps a Windows drive path rooted', () => {
    expect(
      resolveNoteRelativeLink('/c:/notes/index.mk.md', '../other.md'),
    ).toBe('/c:/other.md');
    expect(
      resolveNoteRelativeLink('/c:/notes/index.mk.md', '../../other.md'),
    ).toBeUndefined();
  });

  it('works for a relative note path with no leading separator', () => {
    expect(resolveNoteRelativeLink('notes/index.mk.md', 'other.md')).toBe(
      'notes/other.md',
    );
    expect(
      resolveNoteRelativeLink('notes/index.mk.md', '../../other.md'),
    ).toBeUndefined();
  });
});
