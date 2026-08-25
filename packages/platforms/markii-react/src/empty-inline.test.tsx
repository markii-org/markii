import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { renderMark } from './render';
import { createRegistry, type MarkComponentProps } from './registry';

/** An inline-shaped component (emits a `<span>`) whose body might be empty. */
function Chip({ children }: MarkComponentProps): ReactElement {
  return <span className="probe-chip">{children}</span>;
}

const registry = createRegistry({
  chip: { component: Chip, inline: true },
  // A block-kind component must never get the empty-inline marker, even
  // when it too renders no content — the marker is scoped to `inline: true`.
  box: { component: Chip, inline: false },
  // A registration that says nothing about kind keeps rendering exactly as
  // before this rule existed, even with no content.
  quiet: { component: Chip },
});

function html(source: string): HTMLElement {
  return render(renderMark(source, registry)).container;
}

describe('ITEM 1: an inline component that renders empty', () => {
  it('still renders the component (no fallback box) when written empty as a leaf', () => {
    const container = html('::chip{label="x"}');
    const chip = container.querySelector('.probe-chip');
    expect(chip).not.toBeNull();
    expect(container.querySelector('.mk-unknown')).toBeNull();
  });

  it('wraps the empty component in the quiet marker with an explanatory title', () => {
    const container = html('::chip{label="x"}');
    const marker = container.querySelector('.mk-inline-empty');
    expect(marker).not.toBeNull();
    expect(marker?.querySelector('.probe-chip')).not.toBeNull();
    expect(marker?.getAttribute('title')).toContain('chip');
  });

  it('written as an inline directive with empty brackets also gets the marker', () => {
    const container = html(':chip[]');
    expect(container.querySelector('.mk-inline-empty')).not.toBeNull();
  });

  it('does NOT mark a chip that has content', () => {
    const container = html(':chip[hello]');
    expect(container.querySelector('.mk-inline-empty')).toBeNull();
    expect(container.querySelector('.probe-chip')?.textContent).toBe('hello');
  });

  it('does NOT mark an empty component registered inline: false', () => {
    const container = html('::box{}');
    expect(container.querySelector('.mk-inline-empty')).toBeNull();
    expect(container.querySelector('.probe-chip')).not.toBeNull();
  });

  it('does NOT mark an empty component with no inline metadata at all', () => {
    const container = html('::quiet{}');
    expect(container.querySelector('.mk-inline-empty')).toBeNull();
    expect(container.querySelector('.probe-chip')).not.toBeNull();
  });

  it('whitespace-only content still counts as empty', () => {
    const container = html('::chip{}\n\n');
    // Directive with a blank body renders no children at all.
    expect(container.querySelector('.mk-inline-empty')).not.toBeNull();
  });
});
