import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { createRegistry, mergeRegistries } from '@markii/react';
import type { MarkComponentProps, Registry } from '@markii/react';
import { defaultRegistry } from '@markii/react/components';
import { exportResultFor, renderExportBody } from './export-render.js';
import type { ExportRequestMessage } from '../protocol.js';

/** A tiny fake pack component, standing in for a real compiled pack module — never a real pack build, matching the "hand-built registry" pattern `pack-registry.test.ts` already uses. */
function Timeline({ attributes }: MarkComponentProps): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'ana-timeline' },
    `timeline: ${attributes.title ?? ''}`,
  );
}

function registryWithFakePack(): Registry {
  return mergeRegistries(
    defaultRegistry,
    createRegistry({ 'ana-timeline': { component: Timeline } }),
  );
}

describe('renderExportBody', () => {
  it('renders a pack component as itself, not as the unknown-component fallback', () => {
    const registry = registryWithFakePack();
    const html = renderExportBody('::ana-timeline{title="Q1"}', {}, registry);
    expect(html).toContain('ana-timeline');
    expect(html).toContain('Q1');
    expect(html).not.toContain('mk-unknown');
  });

  it('renders the standard set unchanged with no values', () => {
    const html = renderExportBody('# Hello', {}, defaultRegistry);
    expect(html).toContain('Hello');
  });

  it('binds a stored value into a data-bound component', () => {
    const html = renderExportBody(
      '::stat{data="count"}',
      { count: { value: 42, status: 'fresh' } },
      defaultRegistry,
    );
    expect(html).toContain('42');
  });
});

describe('exportResultFor', () => {
  const baseMessage: ExportRequestMessage = {
    type: 'export-request',
    requestId: 'req-1',
    text: '# Hi',
    values: {},
  };

  it('returns ok:true with the rendered body on success', () => {
    const result = exportResultFor(baseMessage, defaultRegistry);
    expect(result).toEqual({
      type: 'export-result',
      requestId: 'req-1',
      ok: true,
      html: expect.stringContaining('Hi') as unknown as string,
    });
  });

  it('returns ok:false with a short reason when the registry throws', () => {
    const throwingRegistry = createRegistry({
      boom: {
        component: () => {
          throw new Error('pack component exploded');
        },
      },
    });
    const result = exportResultFor(
      { ...baseMessage, text: '::boom' },
      throwingRegistry,
    );
    expect(result.ok).toBe(false);
    expect(result.type).toBe('export-result');
    expect(result.requestId).toBe('req-1');
    if (!result.ok) {
      expect(result.reason).toContain('pack component exploded');
    }
  });
});
