import type { ReactElement } from 'react';
import { renderMark } from '@markii/react';
import { defaultRegistry } from '@markii/react/components';

/**
 * Renders one `.mk.md` document's text into the React tree `@markii/react`
 * produces for it — no scripting, no packs, no bundles, just the plain
 * registry-driven render (spike scope, per AGENTS.md's product principles
 * and the task's explicit "resist scope creep").
 *
 * Deliberately `obsidian`-free (see `src/main.ts`'s file-scope note): this
 * is the ONE piece of testable rendering logic the plugin has, so it lives
 * in a plain module `view.tsx` calls, the same split
 * `apps/vscode/src/mark-document.ts` and friends use for the VS Code
 * extension.
 */
export function renderDocument(text: string): ReactElement {
  return renderMark(text, defaultRegistry);
}
