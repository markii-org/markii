import { describe, expect, it } from 'vitest';
import { resolveColor, resolveWidth } from './render-note.js';

describe('resolveWidth', () => {
  it('prefers an explicit --width', () => {
    expect(resolveWidth(120, { columns: 80 })).toBe(120);
  });

  it('falls back to the terminal columns', () => {
    expect(resolveWidth(undefined, { columns: 100 })).toBe(100);
  });

  it('falls back to 80 with no width flag and no terminal columns', () => {
    expect(resolveWidth(undefined, { columns: undefined })).toBe(80);
  });

  it('falls back to 80 when the terminal reports zero columns', () => {
    expect(resolveWidth(undefined, { columns: 0 })).toBe(80);
  });
});

describe('resolveColor', () => {
  it('detects from the environment and TTY-ness when unset', () => {
    expect(resolveColor(undefined, { env: {}, stdoutIsTty: false })).toBe(
      'none',
    );
    expect(
      resolveColor(undefined, {
        env: { COLORTERM: 'truecolor' },
        stdoutIsTty: true,
      }),
    ).toBe('truecolor');
  });

  it('detects the same way for an explicit "auto"', () => {
    expect(
      resolveColor('auto', {
        env: { COLORTERM: 'truecolor' },
        stdoutIsTty: true,
      }),
    ).toBe('truecolor');
  });

  it('honours NO_COLOR even when a TTY is present', () => {
    expect(
      resolveColor(undefined, {
        env: { NO_COLOR: '1' },
        stdoutIsTty: true,
      }),
    ).toBe('none');
  });

  it('"never" always resolves to none, TTY or not', () => {
    expect(resolveColor('never', { env: {}, stdoutIsTty: true })).toBe('none');
    expect(resolveColor('never', { env: {}, stdoutIsTty: false })).toBe('none');
  });

  it('an explicit level wins over a non-TTY stdout', () => {
    expect(resolveColor('truecolor', { env: {}, stdoutIsTty: false })).toBe(
      'truecolor',
    );
  });

  it('passes through 16 and 256 explicitly', () => {
    expect(resolveColor('16', { env: {}, stdoutIsTty: false })).toBe('16');
    expect(resolveColor('256', { env: {}, stdoutIsTty: false })).toBe('256');
  });
});
