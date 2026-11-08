import { describe, expect, it } from 'vitest';
import type { DiagnosticEvent, UnavailableComponent } from '@markii/stdlib';
import { renderMarkToHtml } from './render';
import { defaultHtmlRegistry } from './components/index.js';

const unavailable: UnavailableComponent[] = [
  { directive: 'ana_meter', pack: 'ana', engines: ['react'] },
];

describe('a component of an installed pack with no view for this engine', () => {
  it('reads "no HTML view for" in the same box, content kept', () => {
    const html = renderMarkToHtml(
      ':::ana_meter\nbody text\n:::',
      defaultHtmlRegistry,
      undefined,
      undefined,
      { unavailableComponents: unavailable },
    );
    expect(html).toContain(
      '<div class="mk-unknown mk-unknown--block mk-unknown--no-view" title="The ana pack has no HTML view for this component; it has views for: react">',
    );
    expect(html).toContain(
      '<p class="mk-unknown__label">no HTML view for <code>ana_meter</code></p>',
    );
    expect(html).toContain('body text');
  });

  it('keeps "unknown component" for a name the host did not list', () => {
    const html = renderMarkToHtml(
      '::ana_typo{}',
      defaultHtmlRegistry,
      undefined,
      undefined,
      { unavailableComponents: unavailable },
    );
    expect(html).toContain('unknown component <code>ana_typo</code>');
    expect(html).not.toContain('no-view');
  });

  it('is unchanged when the option is omitted', () => {
    const html = renderMarkToHtml('::ana_meter{}', defaultHtmlRegistry);
    expect(html).toContain('unknown component <code>ana_meter</code>');
    expect(html).not.toContain('no HTML view');
  });

  it('uses the inline form for a text directive', () => {
    const html = renderMarkToHtml(
      'see :ana_meter[x] here',
      defaultHtmlRegistry,
      undefined,
      undefined,
      { unavailableComponents: unavailable },
    );
    expect(html).toContain('mk-unknown mk-unknown--inline mk-unknown--no-view');
    expect(html).toContain('no HTML view for <code>ana_meter</code>');
  });

  it('reports one no-engine-view diagnostic per listed directive use', () => {
    const events: DiagnosticEvent[] = [];
    renderMarkToHtml(
      '::ana_meter{}\n\n::ana_typo{}',
      defaultHtmlRegistry,
      undefined,
      undefined,
      {
        unavailableComponents: unavailable,
        onDiagnostic: (event) => events.push(event),
      },
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('no-engine-view');
    expect(events[0]?.directive).toBe('ana_meter');
    expect(events[0]?.message).toContain('The ana pack');
  });

  it('does not resolve a hostile name through the prototype chain', () => {
    const html = renderMarkToHtml(
      '::constructor{}',
      defaultHtmlRegistry,
      undefined,
      undefined,
      { unavailableComponents: unavailable },
    );
    expect(html).toContain('unknown component <code>constructor</code>');
  });
});
