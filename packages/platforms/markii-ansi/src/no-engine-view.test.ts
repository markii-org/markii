import { describe, expect, it } from 'vitest';
import type { DiagnosticEvent, UnavailableComponent } from '@markii/stdlib';
import { renderMarkToAnsi } from './render.js';
import { defaultAnsiRegistry } from './components/index.js';

const unavailable: UnavailableComponent[] = [
  { directive: 'ana_meter', pack: 'ana', engines: ['react'] },
];

async function plain(
  source: string,
  options: Parameters<typeof renderMarkToAnsi>[4] = {},
): Promise<string> {
  return renderMarkToAnsi(source, defaultAnsiRegistry, undefined, undefined, {
    width: 60,
    color: 'never',
    ...options,
  });
}

describe('a component of an installed pack with no view for this engine', () => {
  it('reads "no terminal view for" in the same dashed frame, content kept', async () => {
    const out = await plain(':::ana_meter\nbody text\n:::', {
      unavailableComponents: unavailable,
    });
    expect(out).toContain('no terminal view for `ana_meter`');
    expect(out).toContain('body text');
    expect(out).not.toContain('unknown component');
    // The frame is the one a real unknown gets.
    const unknown = await plain(':::ana_typo\nbody text\n:::', {
      unavailableComponents: unavailable,
    });
    expect(unknown).toContain('unknown component `ana_typo`');
    expect(out.split('\n').length).toBe(unknown.split('\n').length);
  });

  it('is unchanged when the option is omitted', async () => {
    const out = await plain('::ana_meter{}');
    expect(out).toContain('unknown component `ana_meter`');
    expect(out).not.toContain('no terminal view');
  });

  it('uses the inline form for a text directive', async () => {
    const out = await plain('see :ana_meter[x] here', {
      unavailableComponents: unavailable,
    });
    expect(out).toContain('no terminal view for `ana_meter`: x');
  });

  it('reports a no-engine-view diagnostic naming the pack and engines', async () => {
    const events: DiagnosticEvent[] = [];
    await plain('::ana_meter{}\n\n::ana_typo{}', {
      unavailableComponents: unavailable,
      onDiagnostic: (event) => events.push(event),
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('no-engine-view');
    expect(events[0]?.directive).toBe('ana_meter');
    expect(events[0]?.message).toContain('The ana pack');
    expect(events[0]?.message).toContain('react');
  });

  it('does not resolve a hostile name through the prototype chain', async () => {
    const out = await plain('::constructor{}', {
      unavailableComponents: unavailable,
    });
    expect(out).toContain('unknown component `constructor`');
  });
});

describe('a component of a pack that failed to load', () => {
  const failed: UnavailableComponent[] = [
    {
      directive: 'ana_meter',
      pack: 'ana',
      engines: ['ansi'],
      loadFailed: true,
    },
  ];

  it('reads "the pack failed to load" in the same frame, content kept', async () => {
    const out = await plain(':::ana_meter\nbody text\n:::', {
      unavailableComponents: failed,
    });
    expect(out).toContain('the `ana` pack failed to load');
    expect(out).toContain('`ana_meter`');
    expect(out).toContain('body text');
    expect(out).not.toContain('unknown component');
  });

  it('uses the inline form for a text directive', async () => {
    const out = await plain('see :ana_meter[x] here', {
      unavailableComponents: failed,
    });
    expect(out).toContain('pack failed to load');
  });

  it('reports a diagnostic naming the pack', async () => {
    const events: DiagnosticEvent[] = [];
    await plain('::ana_meter{}', {
      unavailableComponents: failed,
      onDiagnostic: (event) => events.push(event),
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.message).toContain('The ana pack failed to load');
  });
});
