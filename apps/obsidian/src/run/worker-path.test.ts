import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveWorkerPath } from './worker-path.js';

describe('resolveWorkerPath', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('returns undefined when no worker.js exists in the plugin folder', () => {
    dir = mkdtempSync(join(tmpdir(), 'markii-worker-path-'));
    expect(resolveWorkerPath(dir)).toBeUndefined();
  });

  it('returns the joined path when worker.js exists', () => {
    dir = mkdtempSync(join(tmpdir(), 'markii-worker-path-'));
    const workerPath = join(dir, 'worker.js');
    writeFileSync(workerPath, '// stub');
    expect(resolveWorkerPath(dir)).toBe(workerPath);
  });
});
