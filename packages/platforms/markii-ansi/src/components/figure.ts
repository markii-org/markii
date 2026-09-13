import { isSafeUrl } from '@markii/core';
import { reportDiagnostic } from '@markii/stdlib';
import { resolveImageAttribute } from '../image-resolve.js';
import {
  unsafeImageSrcLabel,
  unsafeImageSrcTitle,
} from '../failure-presentation.js';
import { childrenText, type AnsiComponent } from '../registry.js';

const DEFAULT_ALT = '';
const DIRECTIVE_NAME = 'figure';

/**
 * `:::figure{src="..." alt="..."} caption markdown :::` — an image with a
 * rich (markdown) caption. `src` is required; a missing `src` shows only
 * the caption. Security: `src` bypasses `@markii/core`'s hast-level URL
 * sanitizer (it is a directive attribute, not a markdown image), so this
 * component closes that gap itself with `isSafeUrl`.
 */
export const Figure: AnsiComponent = ({ attributes, children, ctx }) => {
  const rawSrc = attributes.src ?? null;
  const alt = attributes.alt ?? DEFAULT_ALT;
  const refused = Boolean(rawSrc) && !isSafeUrl(rawSrc as string);
  const safeSrc = rawSrc && !refused ? rawSrc : null;
  const src = safeSrc
    ? ctx.text(resolveImageAttribute(safeSrc, ctx.resolveImageSrc))
    : null;

  const lines: string[] = [];
  if (rawSrc) {
    if (alt) lines.push(ctx.dim(`alt: ${ctx.text(alt)}`));
    if (refused) {
      reportDiagnostic(ctx.onDiagnostic, {
        kind: 'unsafe-image-src',
        directive: DIRECTIVE_NAME,
        message: unsafeImageSrcTitle(DIRECTIVE_NAME),
      });
      lines.push(ctx.dim(`[${unsafeImageSrcLabel(DIRECTIVE_NAME)}]`));
    } else if (src) {
      lines.push(ctx.dim(src));
    }
  }
  const body = childrenText(children);
  if (body) lines.push(body);

  return lines.join('\n');
};
