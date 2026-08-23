import { isSafeUrl } from '@markii/core';
import type { HtmlComponent } from '../registry.js';

const DEFAULT_ALT = '';

/**
 * `:::figure{src="..." alt="..."} caption markdown :::` — an image with a
 * rich (markdown) caption. `src` is required; a missing `src` renders no
 * image at all (the caption still renders, matching the graceful-
 * degradation spirit of the unknown-directive fallback rather than
 * throwing).
 *
 * Security: `src` is a directive *attribute*, handed to this component as a
 * raw string and put straight into `<img src>` — that assignment BYPASSES
 * `@markii/core`'s `to-hast.ts` URL sanitizer, which only walks the hast
 * tree produced from ordinary markdown links/images. This component closes
 * that gap by running `src` through `@markii/core`'s own `isSafeUrl` (the
 * exact same allowlist check the sanitizer uses) and dropping the image
 * entirely when it fails, rather than re-implementing URL-scheme parsing
 * here. Matches `@markii/react`'s `Figure` markup byte-for-byte.
 */
export const Figure: HtmlComponent = (attributes, childrenHtml, ctx) => {
  const rawSrc = attributes.src ?? null;
  const alt = attributes.alt ?? DEFAULT_ALT;
  const src = rawSrc && isSafeUrl(rawSrc) ? rawSrc : null;

  const imgHtml = src
    ? `<img class="mk-figure__img" src="${ctx.esc(src)}" alt="${ctx.esc(alt)}">`
    : '';

  return (
    `<figure class="mk-figure">${imgHtml}` +
    `<figcaption class="mk-figure__caption">${childrenHtml}</figcaption></figure>`
  );
};
