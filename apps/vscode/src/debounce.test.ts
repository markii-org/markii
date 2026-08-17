import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncer } from './debounce';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createDebouncer', () => {
  it('does not run before the delay elapses', () => {
    const run = vi.fn();
    const debouncer = createDebouncer<string>(200, run);
    debouncer.schedule('a');
    vi.advanceTimersByTime(199);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs once the delay elapses', () => {
    const run = vi.fn();
    const debouncer = createDebouncer<string>(200, run);
    debouncer.schedule('a');
    vi.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('a');
  });

  it('collapses rapid schedule calls into a single run', () => {
    const run = vi.fn();
    const debouncer = createDebouncer<number>(200, run);
    debouncer.schedule(1);
    vi.advanceTimersByTime(50);
    debouncer.schedule(2);
    vi.advanceTimersByTime(50);
    debouncer.schedule(3);
    vi.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('the last value wins when calls collapse', () => {
    const run = vi.fn();
    const debouncer = createDebouncer<number>(200, run);
    debouncer.schedule(1);
    debouncer.schedule(2);
    debouncer.schedule(3);
    vi.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledWith(3);
  });

  it('cancel drops a pending call', () => {
    const run = vi.fn();
    const debouncer = createDebouncer<string>(200, run);
    debouncer.schedule('a');
    debouncer.cancel();
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
  });

  it('cancel with nothing pending is a no-op', () => {
    const run = vi.fn();
    const debouncer = createDebouncer<string>(200, run);
    expect(() => {
      debouncer.cancel();
    }).not.toThrow();
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
  });

  it('a schedule call after a previous run has fired starts a fresh delay', () => {
    const run = vi.fn();
    const debouncer = createDebouncer<string>(200, run);
    debouncer.schedule('first');
    vi.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledTimes(1);

    debouncer.schedule('second');
    vi.advanceTimersByTime(199);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith('second');
  });

  it('uses an injected TimerApi instead of globalThis when supplied', () => {
    let scheduled: (() => void) | undefined;
    let clearedId: number | undefined;
    const fakeTimers = {
      setTimeout: vi.fn((handler: () => void, _ms: number) => {
        scheduled = handler;
        return 7;
      }),
      clearTimeout: vi.fn((id: number) => {
        clearedId = id;
      }),
    };
    const run = vi.fn();
    const debouncer = createDebouncer<string>(200, run, fakeTimers);

    debouncer.schedule('a');
    expect(fakeTimers.setTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      200,
    );

    debouncer.schedule('b');
    expect(clearedId).toBe(7);

    scheduled?.();
    expect(run).toHaveBeenCalledWith('b');
  });
});
