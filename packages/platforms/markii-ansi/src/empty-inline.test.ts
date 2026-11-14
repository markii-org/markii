import { describe, expect, it } from 'vitest';
import type { DiagnosticEvent } from '@markii/stdlib';
import { renderMarkToAnsi } from './render.js';
import { defaultAnsiRegistry } from './components/index.js';

async function plain(
  source: string,
  events: DiagnosticEvent[],
): Promise<string> {
  return renderMarkToAnsi(source, defaultAnsiRegistry, undefined, undefined, {
    width: 200,
    color: 'never',
    onDiagnostic: (event) => events.push(event),
  });
}

describe('the empty-inline marker reaches onDiagnostic (terminal engine)', () => {
  it('reports one empty-inline event with the marker wording', async () => {
    const events: DiagnosticEvent[] = [];
    const out = await plain('text :badge[] end', events);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('empty-inline');
    expect(events[0]?.directive).toBe('badge');
    expect(out).toContain(events[0]?.message ?? '(missing)');
  });

  it('reports nothing for an inline component with content', async () => {
    const events: DiagnosticEvent[] = [];
    await plain('text :badge[ok] end', events);
    expect(events).toEqual([]);
  });

  it('reports nothing for an inline component given attributes and no content', async () => {
    const events: DiagnosticEvent[] = [];
    const out = await plain('text :badge{variant=info} end', events);
    expect(events).toEqual([]);
    expect(out).not.toContain('no content');
  });

  it('reports nothing for an inline component given only data=', async () => {
    const events: DiagnosticEvent[] = [];
    const out = await plain('text :badge{data=total} end', events);
    expect(events).toEqual([]);
    expect(out).not.toContain('no content');
  });
});
