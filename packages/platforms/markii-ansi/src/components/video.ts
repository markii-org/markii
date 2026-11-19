import { isSafeUrl } from '@markii/core';
import { reportDiagnostic, type OnDiagnostic } from '@markii/stdlib';
import { hyperlink, type ColorLevel } from '../ansi.js';
import type { GlyphSet } from '../glyphs.js';
import { resolveVideoSrc } from '../image-resolve.js';
import type { ResolveImageSrc } from '../image-resolve.js';
import { sanitizeUrlText } from '../sanitize.js';
import {
  missingVideoSrcLabel,
  missingVideoSrcTitle,
  unsafeVideoPosterLabel,
  unsafeVideoPosterTitle,
  unsafeVideoSrcLabel,
  unsafeVideoSrcTitle,
} from '../failure-presentation.js';
import { childrenText, type AnsiComponent } from '../registry.js';

const DIRECTIVE_NAME = 'video';

/** What `videoHeaderLines` needs from a render: the string engine's `ctx` and the Ink walk's context both supply it. */
export interface VideoHeaderContext {
  readonly color: ColorLevel;
  readonly glyphs: GlyphSet;
  readonly resolveImageSrc: ResolveImageSrc | undefined;
  readonly onDiagnostic: OnDiagnostic | undefined;
  readonly dim: (text: string) => string;
  /** Strips control characters from author text. */
  readonly text: (value: string) => string;
}

/**
 * The lines above a `video`'s caption: the play glyph, the word `video` and
 * the `alt` text, linked to the resolved clip. A terminal that cannot link
 * shows the address in parentheses after the label. A refused or missing
 * `src`, or a refused `poster`, adds a dim marker line and reports the full
 * sentence through `onDiagnostic`. The terminal draws no poster, so a
 * refused one only produces the marker.
 *
 * Security: `src` and `poster` are directive attributes that bypass the
 * markdown URL sanitizer, so each goes through `isSafeUrl` first. A clip
 * also refuses every `data:` URL.
 */
export function videoHeaderLines(
  attributes: Readonly<Record<string, string | null | undefined>>,
  ctx: VideoHeaderContext,
): string[] {
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

  const lines: string[] = [];
  const label = `${ctx.glyphs.play} ${DIRECTIVE_NAME}${alt === '' ? '' : ` ${ctx.text(alt)}`}`;
  if (src !== null) {
    const shown = ctx.text(src);
    const linkable =
      ctx.color !== 'none' && shown !== '' && sanitizeUrlText(src) === src;
    lines.push(
      linkable ? hyperlink(label, src, ctx.color) : `${label} (${shown})`,
    );
  } else {
    lines.push(label);
  }

  if (srcMissing) {
    reportDiagnostic(ctx.onDiagnostic, {
      kind: 'invalid-attribute-value',
      directive: DIRECTIVE_NAME,
      attribute: 'src',
      message: missingVideoSrcTitle(DIRECTIVE_NAME),
    });
    lines.push(ctx.dim(`[${missingVideoSrcLabel(DIRECTIVE_NAME)}]`));
  } else if (srcRefused) {
    reportDiagnostic(ctx.onDiagnostic, {
      kind: 'unsafe-url',
      directive: DIRECTIVE_NAME,
      message: unsafeVideoSrcTitle(DIRECTIVE_NAME),
    });
    lines.push(ctx.dim(`[${unsafeVideoSrcLabel(DIRECTIVE_NAME)}]`));
  } else if (posterRefused) {
    reportDiagnostic(ctx.onDiagnostic, {
      kind: 'unsafe-url',
      directive: DIRECTIVE_NAME,
      message: unsafeVideoPosterTitle(DIRECTIVE_NAME),
    });
    lines.push(ctx.dim(`[${unsafeVideoPosterLabel(DIRECTIVE_NAME)}]`));
  }
  return lines;
}

/**
 * `:::video{src="..." poster="..." alt="..."} caption markdown :::` as a
 * string: the header lines from `videoHeaderLines`, then the caption.
 */
export const Video: AnsiComponent = ({ attributes, children, ctx }) => {
  const lines = videoHeaderLines(attributes, {
    color: ctx.color,
    glyphs: ctx.glyphs,
    resolveImageSrc: ctx.resolveImageSrc,
    onDiagnostic: ctx.onDiagnostic,
    dim: ctx.dim,
    text: ctx.text,
  });
  const body = childrenText(children);
  if (body) lines.push(body);
  return lines.join('\n');
};
