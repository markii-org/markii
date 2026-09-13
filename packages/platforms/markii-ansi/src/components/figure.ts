import { isSafeUrl } from '@markii/core';
import { reportDiagnostic } from '@markii/stdlib';
import { resolveImageAttribute } from '../image-resolve.js';
import {
  unsafeImageSrcLabel,
  unsafeImageSrcTitle,
} from '../failure-presentation.js';
import type { AnsiComponent } from '../registry.js';

const DEFAULT_ALT = '';
const DIRECTIVE_NAME = 'figure';

/**
 * `:::figure{src="..." alt="..."} caption markdown :::` — an image with a
 * rich (markdown) caption. `src` is required; a missing `src` shows only the
 * caption, matching the graceful-degradation spirit of the unknown-directive
 * fallback rather than throwing.
 *
 * Security: `src` bypasses `@markii/core`'s hast-level URL sanitizer (it is
 * a directive attribute, not a markdown image), so this component closes
 * that gap itself with `@markii/core`'s `isSafeUrl` — the same allowlist the
 * sanitizer uses — and drops the image line entirely on a refusal, replacing
 * it with a short labeled marker (a terminal has no tooltip to carry the
 * full sentence out of the text flow) plus the full sentence reported to
 * `onDiagnostic`; matches `@markii/html`'s `Figure` in behavior, not in the
 * inline wording.
 *
 * Terminal form: alt text, then the (possibly host-resolved) src, then the
 * caption, each on its own line, dimmed except the caption itself.
 */
export const Figure: AnsiComponent = (attributes, children, ctx) => {
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
  const childrenText = children();
  if (childrenText) lines.push(childrenText);

  return lines.join('\n');
};
