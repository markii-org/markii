import type { ReactElement } from 'react';
import { renderMark } from '@markii/react';
import type { Registry } from '@markii/react';
import { defaultRegistry } from '@markii/react/components';
import type { ValueStore } from '@markii/runtime';

/**
 * Renders one `.mk.md` document's text into the React tree `@markii/react`
 * produces for it — the plain registry-driven render plus, once the Run
 * path exists, whatever value `store` a script run produced
 * (`@markii/runtime`'s `createValueStore`, built by `view.tsx` from the
 * most recent run's values). `store` is omitted for a note with no run
 * yet: script blocks show the renderer's collapsed marker and data-bound
 * components show their standard empty states, exactly as before scripting
 * existed here.
 *
 * `registry` defaults to `defaultRegistry` (no packs installed). Once
 * component packs are loaded (`src/packs/pack-context.ts`), `view.tsx`
 * passes the merged registry it built instead, so a note's namespaced
 * directives (`:::ana-timeline`) resolve to the installed pack's
 * components; an unmerged `defaultRegistry` still falls back cleanly for
 * any directive it does not know, per architecture rule 3.
 *
 * Deliberately `obsidian`-free (see `src/main.ts`'s file-scope note): this
 * is the ONE piece of testable rendering logic the plugin has, so it lives
 * in a plain module `view.tsx` calls, the same split
 * `apps/vscode/src/mark-document.ts` and friends use for the VS Code
 * extension.
 */
export function renderDocument(
  text: string,
  store?: ValueStore,
  registry: Registry = defaultRegistry,
): ReactElement {
  return renderMark(text, registry, store);
}
