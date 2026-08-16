import type { ReactElement } from 'react';
import { isSafeUrl } from '@markii/core';
import type { MarkComponentProps } from '../registry';

const DEFAULT_ALT = '';

/**
 * `:::figure{src="..." alt="..."} caption markdown :::` — an image with a
 * rich (markdown) caption. `src` is required; a missing `src` renders no
 * image at all (the caption still renders, matching the graceful-
 * degradation spirit of the unknown-directive fallback rather than
 * throwing).
 *
 * Security: `src` is a directive *attribute*, which the renderer hands to
 * this component as a raw string and which this component then puts
 * straight into `<img src>` — that assignment BYPASSES `@markii/core`'s
 * `to-hast.ts` URL sanitizer, which only walks the hast tree produced from
 * ordinary markdown links/images (`sanitizeUrls`). So a hostile
 * `src="javascript:..."` here would otherwise reach the DOM unsanitized.
 * This component closes that gap by running `src` through `@markii/core`'s
 * own `isSafeUrl` (the exact same allowlist check `sanitizeUrls` uses) and
 * dropping the image entirely when it fails, rather than re-implementing
 * URL-scheme parsing here.
 */
export function Figure({
  attributes,
  children,
}: MarkComponentProps): ReactElement {
  const rawSrc = attributes.src ?? null;
  const alt = attributes.alt ?? DEFAULT_ALT;
  const src = rawSrc && isSafeUrl(rawSrc) ? rawSrc : null;

  return (
    <figure className="mk-figure">
      {src ? <img className="mk-figure__img" src={src} alt={alt} /> : null}
      <figcaption className="mk-figure__caption">{children}</figcaption>
    </figure>
  );
}
