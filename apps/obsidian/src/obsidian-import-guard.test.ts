import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `src/main.ts`, `src/view.tsx`, and `src/settings-tab.ts` are the ONLY
 * files allowed to import `obsidian` (see this workspace's package.json
 * comment / the task's architecture rule): Vitest cannot resolve the
 * `obsidian` module, so every piece of testable logic (rendering, settings
 * normalization) must live in plain modules that never touch it. This
 * mirrors `apps/vscode`'s equivalent split (`extension.ts`/
 * `preview-panel.ts` are its only `vscode`-importing files) — walks the
 * source tree and fails if any OTHER file imports `obsidian`, so a future
 * change can't silently reintroduce it into a module this suite is relying
 * on being testable.
 */
const ALLOWED_FILES = new Set(['main.ts', 'view.tsx', 'settings-tab.ts']);

const IMPORT_PATTERN =
  /from\s+['"]obsidian['"]|require\(\s*['"]obsidian['"]\s*\)/;

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
    if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe('obsidian import boundary', () => {
  it('is imported only by main.ts and view.tsx', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(here)) {
      const name = relative(here, file);
      const content = readFileSync(file, 'utf8');
      if (IMPORT_PATTERN.test(content) && !ALLOWED_FILES.has(name)) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });
});
