import { describe, expect, it } from 'vitest';
import { discoverConfiguredPacks } from './discover-configured-packs.js';

describe('discoverConfiguredPacks', () => {
  it('resolves an empty list to no packs, without touching the filesystem', async () => {
    const packs = await discoverConfiguredPacks([], undefined);
    expect(packs).toEqual([]);
  });

  it('never throws for a folder that does not exist', async () => {
    await expect(
      discoverConfiguredPacks(['/definitely/not/a/real/pack/folder'], '/tmp'),
    ).resolves.toEqual([]);
  });
});
