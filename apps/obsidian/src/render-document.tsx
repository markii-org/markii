import type { ReactElement } from 'react';
import { renderMark } from '@markii/react';
import type { Registry, RenderMarkOptions } from '@markii/react';
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
 * directives (`:::ana_timeline`) resolve to the installed pack's
 * components; an unmerged `defaultRegistry` still falls back cleanly for
 * any directive it does not know, per architecture rule 3.
 *
 * Deliberately `obsidian`-free (see `src/main.ts`'s file-scope note): this
 * is the ONE piece of testable rendering logic the plugin has, so it lives
 * in a plain module `view.tsx` calls, the same split
 * `apps/vscode/src/mark-document.ts` and friends use for the VS Code
 * extension.
 *
 * `resolveImageSrc` is `renderMark`'s image-resolution option
 * (`./preview-images.ts`'s `createVaultImageResolver`), forwarded straight
 * through: both `view.tsx` and `reading-view.ts` build it from the note's
 * own path and the vault, so a relative `<img>` resolves as the tree is
 * built rather than through a DOM pass afterward. Omitted for a document
 * with no vault to resolve against, in which case every image renders with
 * the source unchanged.
 *
 * `onDiagnostic` is the same kind of forward for the render's quiet
 * markers: a known attribute given a value outside its enum, or a figure
 * source refused as unsafe, still renders with a marker in the page, and
 * this is how the reason reaches the plugin's diagnostics surface instead
 * of living only in a tooltip.
 */
export function renderDocument(
  text: string,
  store?: ValueStore,
  registry: Registry = defaultRegistry,
  resolveImageSrc?: RenderMarkOptions['resolveImageSrc'],
  onDiagnostic?: RenderMarkOptions['onDiagnostic'],
): ReactElement {
  return renderMark(text, registry, store, undefined, {
    resolveImageSrc,
    onDiagnostic,
  });
}
