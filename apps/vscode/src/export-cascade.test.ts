import { describe, expect, it } from 'vitest';
import {
  EXPORT_CASCADE_FILTERS,
  EXPORT_CASCADE_NO_DOCUMENT_MESSAGE,
  EXPORT_CASCADE_SAVE_DIALOG_TITLE,
  EXPORT_CASCADE_SAVE_LABEL,
  exportCascadeDefaultFileName,
} from './export-cascade.js';

describe('exportCascadeDefaultFileName', () => {
  it('names the archive after the root note', () => {
    expect(exportCascadeDefaultFileName('/ws/notes/index.mk.md')).toBe(
      'index.zip',
    );
    expect(exportCascadeDefaultFileName('/ws/plain.md')).toBe('plain.zip');
  });
});

describe('the save dialog wording', () => {
  it('offers zip archives and names the command', () => {
    expect(EXPORT_CASCADE_SAVE_DIALOG_TITLE).toBe(
      'Markii: Export as HTML cascade',
    );
    expect(EXPORT_CASCADE_SAVE_LABEL).toBe('Export');
    expect(EXPORT_CASCADE_FILTERS['Zip archive']).toEqual(['zip']);
    expect(EXPORT_CASCADE_NO_DOCUMENT_MESSAGE).toContain('.mk.md');
  });
});
