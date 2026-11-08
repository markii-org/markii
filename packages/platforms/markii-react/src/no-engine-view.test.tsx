import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { DiagnosticEvent, UnavailableComponent } from '@markii/stdlib';
import { renderMark } from './render';
import { defaultRegistry } from './components';

const unavailable: UnavailableComponent[] = [
  { directive: 'ana_meter', pack: 'ana', engines: ['ansi'] },
];

function html(
  source: string,
  options?: Parameters<typeof renderMark>[4],
): HTMLElement {
  return render(
    renderMark(source, defaultRegistry, undefined, undefined, options),
  ).container;
}

describe('a component of an installed pack with no view for this engine', () => {
  it('reads "no preview view for" in the same box, with the content kept', () => {
    const container = html(':::ana_meter\nbody text\n:::', {
      unavailableComponents: unavailable,
    });
    const box = container.querySelector('.mk-unknown');
    expect(box?.className).toBe(
      'mk-unknown mk-unknown--block mk-unknown--no-view',
    );
    expect(box?.querySelector('.mk-unknown__label')?.textContent).toBe(
      'no preview view for ana_meter',
    );
    expect(box?.querySelector('code')?.textContent).toBe('ana_meter');
    expect(box?.getAttribute('title')).toContain('The ana pack');
    expect(box?.getAttribute('title')).toContain('ansi');
    expect(container.textContent).toContain('body text');
  });

  it('keeps "unknown component" for a name the host did not list', () => {
    const container = html('::ana_typo{}', {
      unavailableComponents: unavailable,
    });
    const box = container.querySelector('.mk-unknown');
    expect(box?.className).toBe('mk-unknown mk-unknown--block');
    expect(box?.textContent).toBe('unknown component ana_typo');
    expect(box?.hasAttribute('title')).toBe(false);
  });

  it('is unchanged when the option is omitted', () => {
    const container = html('::ana_meter{}');
    expect(container.querySelector('.mk-unknown')?.textContent).toBe(
      'unknown component ana_meter',
    );
  });

  it('uses the inline form for a text directive', () => {
    const container = html('see :ana_meter[x] here', {
      unavailableComponents: unavailable,
    });
    const box = container.querySelector('.mk-unknown');
    expect(box?.tagName).toBe('SPAN');
    expect(box?.className).toContain('mk-unknown--no-view');
    expect(box?.textContent).toContain('no preview view for ana_meter');
  });

  it('reports a no-engine-view diagnostic naming the pack and engines', () => {
    const events: DiagnosticEvent[] = [];
    html('::ana_meter{}\n\n::ana_typo{}', {
      unavailableComponents: unavailable,
      onDiagnostic: (event) => events.push(event),
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('no-engine-view');
    expect(events[0]?.directive).toBe('ana_meter');
    expect(events[0]?.message).toContain('The ana pack');
    expect(events[0]?.message).toContain('ansi');
  });

  it('does not resolve a hostile directive name through the prototype chain', () => {
    const container = html('::constructor{}', {
      unavailableComponents: unavailable,
    });
    expect(container.querySelector('.mk-unknown')?.textContent).toBe(
      'unknown component constructor',
    );
  });
});
