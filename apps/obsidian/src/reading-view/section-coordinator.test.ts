import { describe, expect, it } from 'vitest';
import { ReadingViewSectionCoordinator } from './section-coordinator.js';

describe('ReadingViewSectionCoordinator', () => {
  it('renders the first section for a docId and empties every later one', () => {
    const coordinator = new ReadingViewSectionCoordinator();

    expect(coordinator.decide('doc-1')).toBe('render');
    expect(coordinator.decide('doc-1')).toBe('empty');
    expect(coordinator.decide('doc-1')).toBe('empty');
  });

  it('tracks each docId independently', () => {
    const coordinator = new ReadingViewSectionCoordinator();

    expect(coordinator.decide('doc-1')).toBe('render');
    expect(coordinator.decide('doc-2')).toBe('render');
    expect(coordinator.decide('doc-1')).toBe('empty');
    expect(coordinator.decide('doc-2')).toBe('empty');
  });

  it('lets a docId render again after it is released', () => {
    const coordinator = new ReadingViewSectionCoordinator();

    expect(coordinator.decide('doc-1')).toBe('render');
    coordinator.release('doc-1');
    expect(coordinator.decide('doc-1')).toBe('render');
  });

  it('releasing an unclaimed docId is a no-op', () => {
    const coordinator = new ReadingViewSectionCoordinator();

    expect(() => coordinator.release('never-claimed')).not.toThrow();
    expect(coordinator.decide('never-claimed')).toBe('render');
  });
});
