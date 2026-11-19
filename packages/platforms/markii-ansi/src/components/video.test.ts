import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';

type Event = { kind: string; message: string; attribute?: string };

async function render(
  source: string,
  options: Record<string, unknown> = {},
): Promise<{ out: string; events: Event[] }> {
  const events: Event[] = [];
  const out = await renderMarkToAnsi(source, undefined, undefined, undefined, {
    onDiagnostic: (e: Event) => events.push(e),
    ...options,
  });
  return { out, events };
}

describe('Video', () => {
  it('shows the glyph, the word video, the alt text, the address and the caption', async () => {
    const { out } = await render(
      ':::video{src="https://x.test/a.mp4" alt="The demo"}\nTen seconds.\n:::\n',
      { color: 'never' },
    );
    const lines = out.trim().split('\n');
    expect(lines[0]).toBe('▶ video The demo (https://x.test/a.mp4)');
    expect(lines[1]).toContain('Ten seconds.');
  });

  it('reads the play glyph from the ascii set', async () => {
    const { out } = await render(':::video{src="a.mp4"}\ncap\n:::\n', {
      color: 'never',
      box: 'ascii',
    });
    expect(out.trim().split('\n')[0]).toBe('> video (a.mp4)');
  });

  it('links the label to the resolved clip when the terminal can link', async () => {
    const { out } = await render(
      ':::video{src="a.mp4" alt="Demo"}\ncap\n:::\n',
      {
        color: 'truecolor',
        resolveImageSrc: () => ({ src: 'app://vault/a.mp4' }),
      },
    );
    expect(out).toContain('\x1b]8;;app://vault/a.mp4\x07');
    expect(out).toContain('video Demo');
  });

  it('strips control characters from alt', async () => {
    const { out } = await render(
      ':::video{src="a.mp4" alt="x\u001b[31my"}\ncap\n:::\n',
      { color: 'never' },
    );
    expect(out).not.toContain('\u001b[31m');
  });

  const refused = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:video/mp4;base64,AAAA',
    'DATA:video/mp4;base64,AAAA',
    'da\tta:video/mp4;base64,AAAA',
  ];
  for (const src of refused) {
    it(`marks and reports a refused src ${JSON.stringify(src)}`, async () => {
      const { out, events } = await render(
        `:::video{src=${JSON.stringify(src)}}\ncaption\n:::\n`,
        { color: 'never' },
      );
      expect(out.toLowerCase()).not.toContain('javascript:');
      expect(out).not.toContain('base64');
      expect(out).toContain('[video: clip not shown]');
      expect(out).toContain('caption');
      expect(out).not.toContain('not allowed');
      expect(events).toMatchObject([
        {
          kind: 'unsafe-url',
          directive: 'video',
          message: 'video: source uses a scheme that is not allowed',
        },
      ]);
    });
  }

  it('marks and reports a refused poster, keeping the clip line', async () => {
    const { out, events } = await render(
      ':::video{src="a.mp4" poster="javascript:alert(1)"}\ncaption\n:::\n',
      { color: 'never' },
    );
    expect(out).toContain('▶ video (a.mp4)');
    expect(out).toContain('[video: poster not shown]');
    expect(events.map((e) => e.message)).toEqual([
      'video: poster uses a scheme that is not allowed, so no poster is shown',
    ]);
  });

  it('marks and reports a missing src', async () => {
    const { out, events } = await render(':::video\ncaption only\n:::\n', {
      color: 'never',
    });
    expect(out).toContain('[video: no source]');
    expect(out).toContain('caption only');
    expect(events).toMatchObject([
      {
        kind: 'invalid-attribute-value',
        directive: 'video',
        attribute: 'src',
        message: 'video: no source was given, so no clip is shown',
      },
    ]);
  });
});
