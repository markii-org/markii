import type { ReactElement } from 'react';
import { isSafeUrl } from '@markii/core';
import { reportDiagnostic } from '@markii/stdlib';
import type { MarkComponentProps } from '../registry.js';
import { resolveImageAttribute } from '../image-resolve.js';
import { unsafeImageSrcTitle } from './failure-presentation.js';

// Matches `failure-presentation.ts`'s `NOTICE_ATTRIBUTE` — kept as a JSX
// literal (not the imported constant) because TypeScript only special-cases
// a literal `data-*` attribute name on a DOM intrinsic element, not a
// computed one; `failure-presentation.test.ts` pins the two to the same
// value so they cannot drift apart.

const DEFAULT_ALT = '';
const DIRECTIVE_NAME = 'figure';

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
 *
 * `resolveImageSrc` (`MarkComponentProps`, `../render.js`'s `renderMark`
 * option) then gets the same chance at an already-safe `src` that an
 * ordinary markdown image gets, so a host resolving relative images sees
 * this component's picture too, not just the ones markdown itself wrote.
 */
export function Figure({
  attributes,
  children,
  resolveImageSrc,
  onDiagnostic,
}: MarkComponentProps): ReactElement {
  const rawSrc = attributes.src ?? null;
  const alt = attributes.alt ?? DEFAULT_ALT;
  const refused = Boolean(rawSrc) && !isSafeUrl(rawSrc as string);
  const safeSrc = rawSrc && !refused ? rawSrc : null;
  const src = safeSrc ? resolveImageAttribute(safeSrc, resolveImageSrc) : null;

  const imgEl = src ? (
    <img className="mk-figure__img" src={src} alt={alt} />
  ) : null;
  const captionEl = (
    <figcaption className="mk-figure__caption">{children}</figcaption>
  );

  // AGENTS.md "clean is not silent": a refused `src` used to render a
  // caption with no image and no explanation. The marker's `title` carries
  // the reason out of the text flow; `onDiagnostic` gives a host the same
  // event for its own diagnostics surface.
  if (refused) {
    const message = unsafeImageSrcTitle(DIRECTIVE_NAME);
    reportDiagnostic(onDiagnostic, {
      kind: 'unsafe-image-src',
      directive: DIRECTIVE_NAME,
      message,
    });
    return (
      <figure className="mk-figure" data-mk-notice="" title={message}>
        {imgEl}
        {captionEl}
      </figure>
    );
  }

  return (
    <figure className="mk-figure">
      {imgEl}
      {captionEl}
    </figure>
  );
}
