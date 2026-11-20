import { useEffect, useRef, type ReactElement } from 'react';
import { isSafeUrl } from '@markii/core';
import { reportDiagnostic } from '@markii/stdlib';
import type { MarkComponentProps } from '../registry.js';
import { resolveImageAttributes, resolveVideoSrc } from '../image-resolve.js';
import {
  missingVideoSrcTitle,
  unsafeVideoPosterTitle,
  unsafeVideoSrcTitle,
} from './failure-presentation.js';

// The literal `data-mk-notice` attribute name matches
// `failure-presentation.ts`'s `NOTICE_ATTRIBUTE`; see `figure.tsx`.

const DIRECTIVE_NAME = 'video';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Plays `video` while at least half of it is in view and pauses it when it
 * leaves, unless the reader prefers reduced motion. A clip the reader paused
 * is never resumed by this hook. When `IntersectionObserver` or `matchMedia`
 * is missing it does nothing, and the reader presses play. A rejected
 * `play()` promise (an autoplay policy) is swallowed.
 */
function useVisibilityPlayback(
  ref: { readonly current: HTMLVideoElement | null },
  enabled: boolean,
): void {
  useEffect(() => {
    const video = ref.current;
    if (!enabled || !video) return undefined;
    if (
      typeof IntersectionObserver !== 'function' ||
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return undefined;
    }
    const reduced = window.matchMedia(REDUCED_MOTION_QUERY);

    let visible = false;
    // True once the reader paused a clip this hook was playing.
    let readerPaused = false;
    // True from this hook's own pause() call until its `pause` event, which
    // the browser fires asynchronously.
    let hookPaused = false;

    const play = (): void => {
      if (readerPaused || reduced.matches || !visible) return;
      try {
        const result = video.play() as Promise<void> | undefined;
        if (result && typeof result.catch === 'function') {
          result.catch(() => undefined);
        }
      } catch {
        // An autoplay policy may refuse; the reader presses play.
      }
    };
    const pause = (): void => {
      hookPaused = true;
      video.pause();
    };

    const onPause = (): void => {
      // A pause the hook did not make came from the reader (the native
      // controls). The end of a clip is not a reader pause.
      if (hookPaused) hookPaused = false;
      else if (!video.ended) readerPaused = true;
    };
    const onPlay = (): void => {
      // The reader pressing play again hands control back to the hook.
      readerPaused = false;
    };
    video.addEventListener('pause', onPause);
    video.addEventListener('play', onPlay);

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
        if (visible) play();
        else if (!video.paused) pause();
      },
      { threshold: [0, 0.5] },
    );
    observer.observe(video);

    const onMotionChange = (): void => {
      if (reduced.matches) {
        if (!video.paused) pause();
      } else {
        play();
      }
    };
    reduced.addEventListener?.('change', onMotionChange);

    return () => {
      observer.disconnect();
      reduced.removeEventListener?.('change', onMotionChange);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('play', onPlay);
    };
  }, [ref, enabled]);
}

/**
 * `:::video{src="..." poster="..." alt="..."} caption markdown :::` — a
 * short looping clip that starts muted, with a rich caption, a replacement
 * for an animated GIF. The native controls let the reader unmute it. It is
 * not a general player: it never starts with sound and embeds nothing.
 *
 * Security: `src` and `poster` are directive attributes, which bypass
 * `@markii/core`'s hast sanitizer, so each goes through `isSafeUrl` first
 * and then through the host's `resolveImageSrc`. A clip also refuses every
 * `data:` URL. A refused or missing `src` draws no `<video>` and keeps the
 * caption, with a quiet marker. A refused `poster` draws the clip without
 * one, with a quiet marker.
 *
 * Playback is progressive: the markup is the same with or without the
 * observers (see `useVisibilityPlayback`).
 */
export function Video({
  attributes,
  children,
  resolveImageSrc,
  onDiagnostic,
}: MarkComponentProps): ReactElement {
  const rawSrc = attributes.src ?? '';
  const rawPoster = attributes.poster ?? '';
  const alt = attributes.alt ?? '';

  const srcMissing = rawSrc.trim() === '';
  const srcSchemeRefused = !srcMissing && !isSafeUrl(rawSrc);
  const src =
    srcMissing || srcSchemeRefused
      ? null
      : resolveVideoSrc(rawSrc, resolveImageSrc);
  const srcRefused = srcSchemeRefused || (!srcMissing && src === null);

  const posterRefused = rawPoster.trim() !== '' && !isSafeUrl(rawPoster);
  const poster =
    rawPoster.trim() === '' || posterRefused
      ? null
      : resolveImageAttributes(rawPoster, resolveImageSrc).src;

  const ref = useRef<HTMLVideoElement>(null);
  useVisibilityPlayback(ref, src !== null);

  const captionEl = (
    <figcaption className="mk-video__caption">{children}</figcaption>
  );

  let message: string | null = null;
  if (srcMissing) message = missingVideoSrcTitle(DIRECTIVE_NAME);
  else if (srcRefused) message = unsafeVideoSrcTitle(DIRECTIVE_NAME);
  else if (posterRefused) message = unsafeVideoPosterTitle(DIRECTIVE_NAME);

  if (message !== null) {
    reportDiagnostic(
      onDiagnostic,
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

  const mediaEl =
    src === null ? null : (
      <span className="mk-video__frame">
        <video
          ref={ref}
          className="mk-video__media"
          src={src}
          poster={poster ?? undefined}
          aria-label={alt === '' ? undefined : alt}
          controls
          muted
          loop
          playsInline
          preload="metadata"
        />
      </span>
    );

  return message === null ? (
    <figure className="mk-video">
      {mediaEl}
      {captionEl}
    </figure>
  ) : (
    <figure className="mk-video" data-mk-notice="" title={message}>
      {mediaEl}
      {captionEl}
    </figure>
  );
}
