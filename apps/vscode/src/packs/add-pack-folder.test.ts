import { describe, expect, it } from 'vitest';
import { appendPackFolder } from './add-pack-folder.js';

describe('appendPackFolder', () => {
  it('appends a new folder to the end, preserving order', () => {
    expect(appendPackFolder(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
  });

  it('appends to an empty list', () => {
    expect(appendPackFolder([], 'a')).toEqual(['a']);
  });

  it('returns undefined (no change) when the folder is already present', () => {
    expect(appendPackFolder(['a', 'b'], 'b')).toBeUndefined();
  });

  it('does not mutate the input list', () => {
    const existing = ['a'];
    appendPackFolder(existing, 'b');
    expect(existing).toEqual(['a']);
  });

  it('treats paths as exact strings (no normalization)', () => {
    // Two spellings of the same folder are distinct here; normalization, if
    // ever wanted, is the caller's concern, not this pure merge's.
    expect(appendPackFolder(['/x/y'], '/x/y/')).toEqual(['/x/y', '/x/y/']);
  });
});
