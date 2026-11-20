import { isSafeUrl } from '@markii/core';
import { reportDiagnostic } from '@markii/stdlib';
import type { HtmlComponent } from '../registry.js';
import { resolveImageAttributes, resolveVideoSrc } from '../image-resolve.js';
import {
  missingVideoSrcTitle,
  unsafeVideoPosterTitle,
  unsafeVideoSrcTitle,
} from '../failure-presentation.js';

const DIRECTIVE_NAME = 'video';

/**
 * `:::video{src="..." poster="..." alt="..."} caption markdown :::` — a
 * short looping clip that starts muted, with a rich caption. Matches `@markii/react`'s
 * `Video` markup byte-for-byte. The output is static: the reader presses
 * play, and the page runs no script.
 *
 * Security: `src` and `poster` bypass `@markii/core`'s hast sanitizer, so
 * each goes through `isSafeUrl` and then `ctx.resolveImageSrc`. A clip also
 * refuses every `data:` URL. A refused or missing `src` draws no `<video>`
 * and keeps the caption, with a quiet marker. A refused `poster` draws the
 * clip without one, with a quiet marker.
 */
export const Video: HtmlComponent = (attributes, childrenHtml, ctx) => {
  const rawSrc = attributes.src ?? '';
  const rawPoster = attributes.poster ?? '';
  const alt = attributes.alt ?? '';

  const srcMissing = rawSrc.trim() === '';
  const srcSchemeRefused = !srcMissing && !isSafeUrl(rawSrc);
  const src =
    srcMissing || srcSchemeRefused
      ? null
      : resolveVideoSrc(rawSrc, ctx.resolveImageSrc);
  const srcRefused = srcSchemeRefused || (!srcMissing && src === null);

  const posterRefused = rawPoster.trim() !== '' && !isSafeUrl(rawPoster);
  const poster =
    rawPoster.trim() === '' || posterRefused
      ? null
      : resolveImageAttributes(rawPoster, ctx.resolveImageSrc).src;

  let message: string | null = null;
  if (srcMissing) message = missingVideoSrcTitle(DIRECTIVE_NAME);
  else if (srcRefused) message = unsafeVideoSrcTitle(DIRECTIVE_NAME);
  else if (posterRefused) message = unsafeVideoPosterTitle(DIRECTIVE_NAME);

  if (message !== null) {
    reportDiagnostic(
      ctx.onDiagnostic,
      srcMissing
        ? {
            kind: 'invalid-attribute-value',
            directive: DIRECTIVE_NAME,
            attribute: 'src',
            message,
          }
        : { kind: 'unsafe-url', directive: DIRECTIVE_NAME, message },
    );
  }

  const mediaHtml =
    src === null
      ? ''
      : `<span class="mk-video__frame"><video class="mk-video__media" src="${ctx.esc(src)}"` +
        (poster === null ? '' : ` poster="${ctx.esc(poster)}"`) +
        (alt === '' ? '' : ` aria-label="${ctx.esc(alt)}"`) +
        ` controls muted loop playsinline preload="metadata"></video></span>`;
  const captionHtml = `<figcaption class="mk-video__caption">${childrenHtml}</figcaption>`;

  if (message !== null) {
    return (
      `<figure class="mk-video" data-mk-notice="" title="${ctx.esc(message)}">` +
      `${mediaHtml}${captionHtml}</figure>`
    );
  }
  return `<figure class="mk-video">${mediaHtml}${captionHtml}</figure>`;
};
