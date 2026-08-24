import { describe, expect, it } from 'vitest';
import {
  FALLBACK_PREVIEW_TITLE,
  isMarkFileName,
  isPreviewableDocument,
  MARK_EXTENSION,
  previewTitleFor,
} from './mark-document';

describe('previewTitleFor', () => {
  it('names the tab after the document it is following', () => {
    expect(previewTitleFor('/home/user/notes/todo.mk.md')).toBe(
      'Preview todo.mk.md',
    );
  });

  it('handles a bare file name with no directories', () => {
    expect(previewTitleFor('notes.mk.md')).toBe('Preview notes.mk.md');
  });

  it('handles a Windows-style URI path (vscode.Uri.path is always /-separated)', () => {
    expect(previewTitleFor('/c:/Users/me/notes.mk.md')).toBe(
      'Preview notes.mk.md',
    );
  });

  it('falls back when the path has no base name', () => {
    expect(previewTitleFor('')).toBe(FALLBACK_PREVIEW_TITLE);
    expect(previewTitleFor('/')).toBe(FALLBACK_PREVIEW_TITLE);
  });
});

describe('MARK_EXTENSION', () => {
  it('is .mk.md', () => {
    expect(MARK_EXTENSION).toBe('.mk.md');
  });
});

describe('isMarkFileName', () => {
  it('accepts a simple .mk.md file name', () => {
    expect(isMarkFileName('notes.mk.md')).toBe(true);
  });

  it('accepts a path with directories', () => {
    expect(isMarkFileName('/home/user/notes/todo.mk.md')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isMarkFileName('NOTES.MK.MD')).toBe(true);
    expect(isMarkFileName('Notes.Mk.Md')).toBe(true);
  });

  it('rejects a plain .md file', () => {
    expect(isMarkFileName('notes.md')).toBe(false);
  });

  it('rejects a file with no extension', () => {
    expect(isMarkFileName('notes')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isMarkFileName('')).toBe(false);
  });

  it('rejects bare .mk.md with no base name', () => {
    expect(isMarkFileName('.mk.md')).toBe(false);
  });

  it('rejects bare .mk.md (uppercase) with no base name', () => {
    expect(isMarkFileName('.MK.MD')).toBe(false);
  });

  it('accepts a single-character base name', () => {
    expect(isMarkFileName('a.mk.md')).toBe(true);
  });

  it('rejects a name that merely contains .mk.md in the middle', () => {
    expect(isMarkFileName('notes.mk.md.bak')).toBe(false);
  });
});

describe('isPreviewableDocument', () => {
  it('accepts a markii document (what .mk.md files are) with the file scheme', () => {
    expect(
      isPreviewableDocument({
        languageId: 'markii',
        uri: { scheme: 'file' },
      }),
    ).toBe(true);
  });

  it('accepts a markii document with the untitled scheme', () => {
    expect(
      isPreviewableDocument({
        languageId: 'markii',
        uri: { scheme: 'untitled' },
      }),
    ).toBe(true);
  });

  it('accepts a plain markdown document with the file scheme (Markii is a superset)', () => {
    expect(
      isPreviewableDocument({
        languageId: 'markdown',
        uri: { scheme: 'file' },
      }),
    ).toBe(true);
  });

  it('accepts a markdown document with the untitled scheme', () => {
    expect(
      isPreviewableDocument({
        languageId: 'markdown',
        uri: { scheme: 'untitled' },
      }),
    ).toBe(true);
  });

  it('rejects a non-markdown language', () => {
    expect(
      isPreviewableDocument({
        languageId: 'plaintext',
        uri: { scheme: 'file' },
      }),
    ).toBe(false);
  });

  it('rejects the output scheme', () => {
    expect(
      isPreviewableDocument({
        languageId: 'markdown',
        uri: { scheme: 'output' },
      }),
    ).toBe(false);
  });

  it('rejects the git scheme (diff editor virtual documents)', () => {
    expect(
      isPreviewableDocument({
        languageId: 'markdown',
        uri: { scheme: 'git' },
      }),
    ).toBe(false);
  });

  it('rejects the preview webview panel scheme', () => {
    expect(
      isPreviewableDocument({
        languageId: 'markdown',
        uri: { scheme: 'vscode-webview' },
      }),
    ).toBe(false);
  });
});
