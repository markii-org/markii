import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * THE RULE THAT MATTERS MOST (task brief, "Storage"): `saveData`/`loadData`
 * write into `.obsidian/plugins/markii/data.json`, INSIDE the vault — it
 * travels with Obsidian Sync and with any vault someone shares, clones, or
 * hands to a colleague. Anything that authorizes execution or network
 * access (network grants, bundle-access grants, auto-run, the scheduled
 * interval, the run cache, last-known values, the last-run trace) MUST use
 * `app.saveLocalStorage`/`app.loadLocalStorage` instead — device-local,
 * never synced or shared. See `src/run/local-storage-memento.ts`'s top
 * comment and `src/local-settings.ts`'s top comment for the full rationale.
 *
 * This is the EXECUTABLE half of that rule: `saveData`/`loadData` calls are
 * only ever legitimate in `src/main.ts`, and only for the one cosmetic
 * setting (`previewPlacement`) that is allowed to travel with the vault.
 * Every Run-path file (`src/run/**`, `src/view.tsx`, `src/run-modals.ts`)
 * must never call either — this test fails the suite the moment one does,
 * so a future change can't silently route a grant, a schedule, or run
 * output through vault-synced storage.
 */
const ALLOWED_FILES = new Set(['main.ts']);

const STORAGE_CALL_PATTERN = /\.(saveData|loadData)\s*\(/;

const here = dirname(fileURLToPath(import.meta.url));

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('device-local storage boundary', () => {
  it('saveData/loadData are called only from main.ts (cosmetic settings)', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(here)) {
      const name = relative(here, file);
      const content = readFileSync(file, 'utf8');
      if (STORAGE_CALL_PATTERN.test(content) && !ALLOWED_FILES.has(name)) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the Run path (src/run/**, src/packs/**, view.tsx, run-modals.ts) never touches saveData/loadData', () => {
    const runPathFiles = [
      ...collectSourceFiles(join(here, 'run')),
      ...collectSourceFiles(join(here, 'packs')),
      join(here, 'view.tsx'),
      join(here, 'run-modals.ts'),
    ];
    const offenders: string[] = [];
    for (const file of runPathFiles) {
      const content = readFileSync(file, 'utf8');
      if (STORAGE_CALL_PATTERN.test(content)) {
        offenders.push(relative(here, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
