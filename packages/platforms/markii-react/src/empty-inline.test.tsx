import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { DiagnosticEvent } from '@markii/stdlib';
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
    const container = html('::chip{}');
    const chip = container.querySelector('.probe-chip');
    expect(chip).not.toBeNull();
    expect(container.querySelector('.mk-unknown')).toBeNull();
  });

  it('wraps the empty component in the quiet marker with an explanatory title', () => {
    const container = html('::chip{}');
    const marker = container.querySelector('.mk-inline-empty');
    expect(marker).not.toBeNull();
    expect(marker?.querySelector('.probe-chip')).not.toBeNull();
    expect(marker?.getAttribute('title')).toContain('chip');
  });

  it('written as an inline directive with empty brackets also gets the marker', () => {
    const container = html(':chip[]');
    expect(container.querySelector('.mk-inline-empty')).not.toBeNull();
  });

  it('does NOT mark a chip that has attributes and no content', () => {
    for (const source of [':chip{variant=info}', '::chip{label="x"}']) {
      const container = html(source);
      expect(container.querySelector('.mk-inline-empty'), source).toBeNull();
      expect(container.querySelector('.probe-chip'), source).not.toBeNull();
    }
  });

  it('does NOT mark a pack-style inline component given only data=', () => {
    const container = html(':chip{data=total}');
    expect(container.querySelector('.mk-inline-empty')).toBeNull();
    expect(container.querySelector('.probe-chip')).not.toBeNull();
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

describe('the empty-inline marker reaches onDiagnostic (React engine)', () => {
  it('reports one empty-inline event with the tooltip wording', () => {
    const events: DiagnosticEvent[] = [];
    const { container } = render(
      renderMark(':chip[]', registry, undefined, undefined, {
        onDiagnostic: (event) => events.push(event),
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('empty-inline');
    expect(events[0]?.directive).toBe('chip');
    expect(
      container.querySelector('.mk-inline-empty')?.getAttribute('title'),
    ).toBe(events[0]?.message);
  });

  it('reports nothing for a chip with content or a block component', () => {
    const events: DiagnosticEvent[] = [];
    const options = { onDiagnostic: (e: DiagnosticEvent) => events.push(e) };
    render(renderMark(':chip[hi]', registry, undefined, undefined, options));
    render(renderMark('::box{}', registry, undefined, undefined, options));
    render(
      renderMark(
        ':chip{variant=info}',
        registry,
        undefined,
        undefined,
        options,
      ),
    );
    expect(events).toEqual([]);
  });
});
