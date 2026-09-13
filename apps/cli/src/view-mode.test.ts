import { describe, expect, it } from 'vitest';
import { resolveViewMode } from './view-mode.js';

describe('resolveViewMode', () => {
  it('is live when both stdin and stdout are TTYs', () => {
    expect(
      resolveViewMode({
        stdinIsTty: true,
        stdoutIsTty: true,
        staticFlag: false,
      }),
    ).toBe('live');
  });

  it('is static when --static is given, even with both TTYs', () => {
    expect(
      resolveViewMode({
        stdinIsTty: true,
        stdoutIsTty: true,
        staticFlag: true,
      }),
    ).toBe('static');
  });

  it('is static when stdout is not a TTY', () => {
    expect(
      resolveViewMode({
        stdinIsTty: true,
        stdoutIsTty: false,
        staticFlag: false,
      }),
    ).toBe('static');
  });

  it('is static when stdin is not a TTY', () => {
    expect(
      resolveViewMode({
        stdinIsTty: false,
        stdoutIsTty: true,
        staticFlag: false,
      }),
    ).toBe('static');
  });

  it('is static when neither stream is a TTY', () => {
    expect(
      resolveViewMode({
        stdinIsTty: false,
        stdoutIsTty: false,
        staticFlag: false,
      }),
    ).toBe('static');
  });
});
