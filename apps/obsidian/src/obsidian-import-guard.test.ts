import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `src/main.ts`, `src/view.tsx`, `src/settings-tab.ts`, and
 * `src/run-modals.ts` are the ONLY files allowed to import `obsidian` (see
 * this workspace's package.json comment / the task's architecture rule):
 * Vitest cannot resolve the `obsidian` module, so every piece of testable
 * logic (rendering, settings normalization, the Run path's grant/
 * worker-path/marker logic) must live in plain modules that never touch it.
 * This mirrors `apps/vscode`'s equivalent split (`extension.ts`/
 * `preview-panel.ts` are its only `vscode`-importing files) — walks the
 * source tree and fails if any OTHER file imports `obsidian`, so a future
 * change can't silently reintroduce it into a module this suite is relying
 * on being testable.
 *
 * `run-modals.ts` was added to this allowlist deliberately when scripting
 * (Run + grants) landed: its network-grant prompts are Obsidian `Modal`
 * subclasses, which cannot exist without importing `obsidian`, and none of
 * that UI wiring is unit-testable regardless of which file it lives in —
 * kept separate from `view.tsx` (which uses it) purely to keep that file
 * from growing into a do-everything module.
 *
 * `insert-modals.ts` was added to this allowlist deliberately when the
 * Insert Component command landed (GitHub issue #17, slice 1): its
 * component picker is a real Obsidian `SuggestModal` subclass, which
 * cannot exist without importing `obsidian`, and is untestable regardless
 * of which file it lives in — kept separate from `main.ts` for the same
 * reason `run-modals.ts` is kept separate from `view.tsx`.
 *
 * `complete-suggest.ts` was added to this allowlist deliberately when
 * directive autocompletion landed (GitHub issue #27, slice 3): its
 * `MarkiiCompletionSuggest` is a real Obsidian `EditorSuggest` subclass,
 * which cannot exist without importing `obsidian`, and is untestable
 * regardless of which file it lives in, for the same reason
 * `insert-modals.ts` is. Every piece worth testing in isolation (the row
 * shape, the query slice, the filter, the wording) lives in
 * `./complete-component.ts`.
 *
 * `reading-view.ts` was added to this allowlist deliberately when Reading
 * view rendering landed (GitHub issue #36): it registers a real
 * `MarkdownPostProcessor` and a `MarkdownRenderChild`, neither of which can
 * exist without importing `obsidian`, and is untestable regardless of
 * which file it lives in. Every piece worth testing in isolation (which
 * section renders, and the wikilink-to-markdown text surgery) lives in
 * `./reading-view/section-coordinator.ts` and `./reading-view/wikilinks.ts`.
 */
const ALLOWED_FILES = new Set([
  'main.ts',
  'view.tsx',
  'settings-tab.ts',
  'run-modals.ts',
  'insert-modals.ts',
  'complete-suggest.ts',
  'reading-view.ts',
]);

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
