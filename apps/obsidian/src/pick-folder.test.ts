import { describe, expect, it, vi } from 'vitest';
import { folderPickerAvailable, pickFolder } from './pick-folder';

const okDialog = (paths: string[], canceled = false) => ({
  dialog: {
    showOpenDialog: vi.fn(() =>
      Promise.resolve({ canceled, filePaths: paths }),
    ),
  },
});

describe('pickFolder', () => {
  it('returns the chosen directory', async () => {
    await expect(pickFolder(() => okDialog(['/home/u/packs']))).resolves.toBe(
      '/home/u/packs',
    );
  });

  it('prefers remote.dialog when both are exposed', async () => {
    const remote = okDialog(['/from/remote']);
    const electron = { ...okDialog(['/from/bare']), remote };
    await expect(pickFolder(() => electron)).resolves.toBe('/from/remote');
  });

  it('is undefined when the user cancels', async () => {
    await expect(
      pickFolder(() => okDialog(['/ignored'], true)),
    ).resolves.toBeUndefined();
  });

  it('is undefined when the dialog returns no path', async () => {
    await expect(pickFolder(() => okDialog([]))).resolves.toBeUndefined();
  });

  // Every one of these is a runtime where the settings tab must still work,
  // with its text field, rather than throwing out of a click handler.
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
    await expect(pickFolder(load as () => unknown)).resolves.toBeUndefined();
  });
});

describe('folderPickerAvailable', () => {
  it('is true only when a usable dialog is present', () => {
    expect(folderPickerAvailable(() => okDialog(['/x']))).toBe(true);
    expect(folderPickerAvailable(() => ({}))).toBe(false);
    expect(
      folderPickerAvailable(() => {
        throw new Error('boom');
      }),
    ).toBe(false);
  });
});
