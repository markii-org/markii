import { describe, expect, it } from 'vitest';
import {
  IMAGE_NO_DOCUMENT_FOLDER_DETAIL,
  formatByteSize,
  imageOutsideWorkspaceDetail,
  imageReadErrorDetail,
} from './export-images.js';

describe('IMAGE_NO_DOCUMENT_FOLDER_DETAIL', () => {
  it('names the missing folder, not a stack trace', () => {
    expect(IMAGE_NO_DOCUMENT_FOLDER_DETAIL).toContain('no folder');
  });
});

describe('imageOutsideWorkspaceDetail', () => {
  it('names the source and says it resolved outside the workspace', () => {
    const detail = imageOutsideWorkspaceDetail('../../../.ssh/id_rsa.png');
    expect(detail).toContain('../../../.ssh/id_rsa.png');
    expect(detail).toContain('outside the workspace');
  });
});

describe('imageReadErrorDetail', () => {
  it('reads an Error message verbatim', () => {
    expect(imageReadErrorDetail(new Error('ENOENT: no such file'))).toBe(
      'ENOENT: no such file',
    );
  });

  it('stringifies a non-Error thrown value', () => {
    expect(imageReadErrorDetail('nope')).toBe('nope');
  });
});

describe('formatByteSize', () => {
  it('shows exact bytes under 1 KB', () => {
    expect(formatByteSize(0)).toBe('0 bytes');
    expect(formatByteSize(1)).toBe('1 byte');
    expect(formatByteSize(512)).toBe('512 bytes');
    expect(formatByteSize(1023)).toBe('1023 bytes');
  });

  it('shows KB with one decimal place, dropping a trailing .0', () => {
    expect(formatByteSize(1024)).toBe('1 KB');
    expect(formatByteSize(1536)).toBe('1.5 KB');
    expect(formatByteSize(10 * 1024)).toBe('10 KB');
  });

  it('shows MB with one decimal place once KB reaches 1024', () => {
    expect(formatByteSize(1024 * 1024)).toBe('1 MB');
    expect(formatByteSize(Math.round(2.5 * 1024 * 1024))).toBe('2.5 MB');
  });
});
