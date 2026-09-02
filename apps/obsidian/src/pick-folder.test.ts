import { describe, expect, it } from 'vitest';
import { packArchivePickerAvailable, pickPackArchiveFile } from './pick-folder';

const okDialog = (paths: string[], canceled = false) => ({
  dialog: {
    showOpenDialog: () => Promise.resolve({ canceled, filePaths: paths }),
  },
});

describe('pickPackArchiveFile', () => {
  it('returns the chosen archive path', async () => {
    await expect(
      pickPackArchiveFile(() => okDialog(['/home/u/ana.mkp'])),
    ).resolves.toBe('/home/u/ana.mkp');
  });

  it('is undefined when the user cancels', async () => {
    await expect(
      pickPackArchiveFile(() => okDialog(['/ignored'], true)),
    ).resolves.toBeUndefined();
  });

  it('degrades to undefined when no picker is available', async () => {
    await expect(pickPackArchiveFile(() => undefined)).resolves.toBeUndefined();
  });

  // Every one of these is a runtime where the install command must still
  // work, rather than throwing out of a click handler.
  it.each([
    ['electron missing', () => undefined],
    ['not an object', () => 42],
    ['no dialog', () => ({})],
    ['dialog is not callable', () => ({ dialog: { showOpenDialog: 'no' } })],
    [
      'require itself throws',
      () => {
        throw new Error('module not found');
      },
    ],
    [
      'showOpenDialog rejects',
      () => ({
        dialog: { showOpenDialog: () => Promise.reject(new Error('x')) },
      }),
    ],
  ])('degrades to undefined: %s', async (_label, load) => {
    await expect(
      pickPackArchiveFile(load as () => unknown),
    ).resolves.toBeUndefined();
  });
});

describe('packArchivePickerAvailable', () => {
  it('is true only when a usable dialog is present', () => {
    expect(packArchivePickerAvailable(() => okDialog(['/x']))).toBe(true);
    expect(packArchivePickerAvailable(() => ({}))).toBe(false);
    expect(
      packArchivePickerAvailable(() => {
        throw new Error('boom');
      }),
    ).toBe(false);
  });
});
