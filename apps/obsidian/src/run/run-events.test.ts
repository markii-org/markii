import { describe, expect, it, vi } from 'vitest';
import { emitValuesChanged, onValuesChanged } from './run-events.js';

describe('run-events', () => {
  it('calls listeners registered for the emitted path', () => {
    const listener = vi.fn();
    const unsubscribe = onValuesChanged('note.mk.md', listener);

    emitValuesChanged('note.mk.md');

    expect(listener).toHaveBeenCalledWith('note.mk.md');
    unsubscribe();
  });

  it('never calls a listener registered for a different path', () => {
    const listener = vi.fn();
    const unsubscribe = onValuesChanged('a.mk.md', listener);

    emitValuesChanged('b.mk.md');

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('stops calling a listener once unsubscribed', () => {
    const listener = vi.fn();
    const unsubscribe = onValuesChanged('note.mk.md', listener);
    unsubscribe();

    emitValuesChanged('note.mk.md');

    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribing twice is a harmless no-op', () => {
    const listener = vi.fn();
    const unsubscribe = onValuesChanged('note.mk.md', listener);
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });

  it('emitting with no listeners is a harmless no-op', () => {
    expect(() => emitValuesChanged('nobody-listens.mk.md')).not.toThrow();
  });

  it('reports a throwing listener without throwing itself, and still calls the others', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwing = vi.fn(() => {
      throw new Error('boom');
    });
    const fine = vi.fn();
    const unsubscribeThrowing = onValuesChanged('note.mk.md', throwing);
    const unsubscribeFine = onValuesChanged('note.mk.md', fine);

    expect(() => emitValuesChanged('note.mk.md')).not.toThrow();

    expect(throwing).toHaveBeenCalled();
    expect(fine).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    unsubscribeThrowing();
    unsubscribeFine();
  });
});
