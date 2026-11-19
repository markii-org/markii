import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { renderMark } from '../render';
import { defaultRegistry } from './index';

function renderVideo(markdown: string, options = {}) {
  return render(
    renderMark(markdown, defaultRegistry, undefined, undefined, options),
  );
}

describe('Video markup', () => {
  it('renders the fixed markup for a clip with poster, alt and caption', () => {
    const { container } = renderVideo(
      ':::video{src="https://x.test/a.mp4" poster="https://x.test/a.png" alt="The demo"}\nThe demo.\n:::',
    );
    const figure = container.querySelector('figure.mk-video');
    expect(figure).not.toBeNull();
    const video = figure?.querySelector(
      'span.mk-video__frame > video.mk-video__media',
    );
    expect(video).toHaveAttribute('src', 'https://x.test/a.mp4');
    expect(video).toHaveAttribute('poster', 'https://x.test/a.png');
    expect(video).toHaveAttribute('aria-label', 'The demo');
    expect(video).toHaveAttribute('preload', 'metadata');
    for (const name of ['controls', 'loop', 'playsinline']) {
      expect(video).toHaveAttribute(name);
    }
    expect((video as HTMLVideoElement).muted).toBe(true);
    expect(video).not.toHaveAttribute('autoplay');
    expect(
      figure?.querySelector('figcaption.mk-video__caption'),
    ).toHaveTextContent('The demo.');
    expect(figure).not.toHaveAttribute('data-mk-notice');
  });

  it('omits poster and aria-label when absent or empty', () => {
    const { container } = renderVideo(
      ':::video{src="clip.mp4" alt=""}\ncaption\n:::',
    );
    const video = container.querySelector('video');
    expect(video).not.toHaveAttribute('poster');
    expect(video).not.toHaveAttribute('aria-label');
  });

  it('resolves src and poster through resolveImageSrc, using only the object form src', () => {
    const { container } = renderVideo(
      ':::video{src="a.mp4" poster="a.png"}\ncaption\n:::',
      {
        resolveImageSrc: (src: string) =>
          src === 'a.mp4'
            ? { src: 'app://vault/a.mp4', width: 10 }
            : 'app://vault/a.png',
      },
    );
    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', 'app://vault/a.mp4');
    expect(video).not.toHaveAttribute('width');
    expect(video).toHaveAttribute('poster', 'app://vault/a.png');
  });
});

describe('Video source refusal', () => {
  const refused = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:video/mp4;base64,AAAA',
    'DATA:video/mp4;base64,AAAA',
    ' \n data:video/mp4;base64,AAAA',
    'da\tta:video/mp4;base64,AAAA',
    'data:text/html,<script>alert(1)</script>',
  ];

  for (const src of refused) {
    it(`draws no <video> and reports a marker for ${JSON.stringify(src)}`, () => {
      const events: { kind: string; message: string; directive?: string }[] =
        [];
      const markdown = `:::video{src=${JSON.stringify(src)}}\ncaption\n:::`;
      const { container } = renderVideo(markdown, {
        onDiagnostic: (e: { kind: string; message: string }) => events.push(e),
      });
      const figure = container.querySelector('figure.mk-video');
      expect(figure?.querySelector('video')).toBeNull();
      expect(figure?.querySelector('figcaption')).toHaveTextContent('caption');
      expect(figure).toHaveAttribute('data-mk-notice');
      expect(figure).toHaveAttribute(
        'title',
        'video: source uses a scheme that is not allowed',
      );
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]).toMatchObject({
        kind: 'unsafe-url',
        directive: 'video',
        message: 'video: source uses a scheme that is not allowed',
      });
      expect(container.innerHTML.toLowerCase()).not.toContain('javascript:');
    });
  }

  it('refuses a data: URL a resolver returns for a clip', () => {
    const { container } = renderVideo(':::video{src="a.mp4"}\ncaption\n:::', {
      resolveImageSrc: () => 'data:image/png;base64,AAAA',
    });
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('figure')).toHaveAttribute('data-mk-notice');
  });

  it('keeps the clip but drops a refused poster, with a marker and a diagnostic', () => {
    const events: { kind: string; message: string }[] = [];
    const { container } = renderVideo(
      ':::video{src="a.mp4" poster="javascript:alert(1)"}\ncaption\n:::',
      {
        onDiagnostic: (e: { kind: string; message: string }) => events.push(e),
      },
    );
    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', 'a.mp4');
    expect(video).not.toHaveAttribute('poster');
    expect(container.querySelector('figure')).toHaveAttribute(
      'title',
      'video: poster uses a scheme that is not allowed, so no poster is shown',
    );
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'unsafe-url',
        message:
          'video: poster uses a scheme that is not allowed, so no poster is shown',
      }),
    ]);
  });

  it('shows the caption and a marker when src is missing', () => {
    const events: { kind: string; attribute?: string }[] = [];
    const { container } = renderVideo(':::video\ncaption only\n:::', {
      onDiagnostic: (e: { kind: string; attribute?: string }) => events.push(e),
    });
    const figure = container.querySelector('figure.mk-video');
    expect(figure?.querySelector('video')).toBeNull();
    expect(figure).toHaveAttribute(
      'title',
      'video: no source was given, so no clip is shown',
    );
    expect(figure?.querySelector('figcaption')).toHaveTextContent(
      'caption only',
    );
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'invalid-attribute-value',
        attribute: 'src',
      }),
    ]);
  });
});

describe('Video playback', () => {
  type Observer = {
    callback: IntersectionObserverCallback;
    observed: Element[];
    disconnected: boolean;
  };
  let observers: Observer[];
  let reduced: boolean;
  let motionListeners: Set<() => void>;
  let play: ReturnType<typeof vi.fn>;
  let pause: ReturnType<typeof vi.fn>;
  let playRejects: boolean;

  beforeEach(() => {
    observers = [];
    reduced = false;
    motionListeners = new Set();
    playRejects = false;

    class FakeObserver {
      private readonly record: Observer;
      constructor(callback: IntersectionObserverCallback) {
        this.record = { callback, observed: [], disconnected: false };
        observers.push(this.record);
      }
      observe(el: Element): void {
        this.record.observed.push(el);
      }
      disconnect(): void {
        this.record.disconnected = true;
      }
      unobserve(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return query.includes('reduce') ? reduced : false;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => motionListeners.add(fn),
      removeEventListener: (_: string, fn: () => void) =>
        motionListeners.delete(fn),
    }));

    // Emulate the media element: play and pause flip `paused` and fire the
    // matching event, the way a browser does.
    let paused = true;
    play = vi.fn(function (this: HTMLVideoElement) {
      paused = false;
      this.dispatchEvent(new Event('play'));
      return playRejects
        ? Promise.reject(new Error('blocked'))
        : Promise.resolve();
    });
    pause = vi.fn(function (this: HTMLVideoElement) {
      paused = true;
      this.dispatchEvent(new Event('pause'));
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(
      play as never,
    );
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
      pause as never,
    );
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(
      () => paused,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const mount = () => {
    const result = renderVideo(':::video{src="a.mp4"}\ncaption\n:::');
    const video = result.container.querySelector('video') as HTMLVideoElement;
    return { ...result, video };
  };
  const intersect = (ratio: number) => {
    const observer = observers[observers.length - 1]!;
    act(() => {
      observer.callback(
        [
          {
            isIntersecting: ratio > 0,
            intersectionRatio: ratio,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
  };

  it('plays when at least half is in view and pauses when it leaves', () => {
    const { video } = mount();
    expect(observers[0]?.observed).toEqual([video]);
    intersect(0.4);
    expect(play).not.toHaveBeenCalled();
    intersect(0.6);
    expect(play).toHaveBeenCalledTimes(1);
    intersect(0);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('never plays under reduced motion, and pauses when the preference turns on', () => {
    reduced = true;
    mount();
    intersect(1);
    expect(play).not.toHaveBeenCalled();

    reduced = false;
    act(() => motionListeners.forEach((fn) => fn()));
    expect(play).toHaveBeenCalledTimes(1);

    reduced = true;
    act(() => motionListeners.forEach((fn) => fn()));
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('does not resume a clip the reader paused', () => {
    const { video } = mount();
    intersect(1);
    expect(play).toHaveBeenCalledTimes(1);

    act(() => {
      video.pause();
    });
    expect(pause).toHaveBeenCalledTimes(1);

    intersect(0);
    intersect(1);
    expect(play).toHaveBeenCalledTimes(1);

    // The reader pressing play again hands control back.
    act(() => {
      video.play().catch(() => undefined);
    });
    intersect(0);
    expect(pause).toHaveBeenCalledTimes(2);
    intersect(1);
    expect(play).toHaveBeenCalledTimes(3);
  });

  it('swallows a rejected play() promise', async () => {
    playRejects = true;
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    mount();
    intersect(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', unhandled);
    expect(play).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('disconnects the observer on unmount', () => {
    const { unmount } = mount();
    unmount();
    expect(observers[0]?.disconnected).toBe(true);
    expect(motionListeners.size).toBe(0);
  });

  it('does nothing when IntersectionObserver is missing', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { video } = mount();
    expect(video).toBeInTheDocument();
    expect(play).not.toHaveBeenCalled();
  });

  it('does nothing when matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined);
    mount();
    expect(observers).toHaveLength(0);
    expect(play).not.toHaveBeenCalled();
  });

  it('observes nothing when there is no clip to play', () => {
    renderVideo(':::video{src="javascript:alert(1)"}\ncaption\n:::');
    expect(observers).toHaveLength(0);
  });
});
