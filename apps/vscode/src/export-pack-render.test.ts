/**
 * GitHub issue #28 slice 2's end-to-end proof: a note using a FAKE pack
 * component, rendered through the exact chain `markii.exportHtml` uses when
 * a panel with webview packs is open. `./webview/export-render.ts`'s
 * `renderExportBody` (the webview's React render) feeds
 * `@markii/host`'s `composeNoteHtmlExport` (the host-neutral page shell,
 * same as `buildNoteExport`'s React branch composes) directly, rather than
 * going through `preview-panel.ts`'s message-passing plumbing, since that
 * plumbing needs a real webview to exercise. What matters here is that the
 * FINISHED document contains the pack component's markup and its
 * stylesheet, and does not fall back to the unknown-component box — the
 * whole point of this slice.
 */
import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { createRegistry, mergeRegistries } from '@markii/react';
import type { MarkComponentProps, Registry } from '@markii/react';
import { defaultRegistry } from '@markii/react/components';
import { composeNoteHtmlExport } from '@markii/host';
import type { ExportPackStylesheet } from '@markii/host';
import { renderExportBody } from './webview/export-render.js';

function Timeline({ attributes }: MarkComponentProps): React.ReactElement {
  return React.createElement(
    'div',
    { className: 'ana-timeline' },
    `Timeline: ${attributes.title ?? 'untitled'}`,
  );
}

function registryWithFakePack(): Registry {
  return mergeRegistries(
    defaultRegistry,
    createRegistry({ 'ana-timeline': { component: Timeline } }),
  );
}

describe('React export path (GitHub issue #28 slice 2)', () => {
  it('embeds a fake pack component and its stylesheet in the finished export', () => {
    const registry = registryWithFakePack();
    const bodyHtml = renderExportBody(
      '# Project status\n\n::ana-timeline{title="Launch"}',
      {},
      registry,
    );

    const stylesheet: ExportPackStylesheet = {
      namespace: 'ana',
      cssText: '.ana-timeline { border: 1px solid var(--mk-border); }',
    };

    const document = composeNoteHtmlExport({
      bodyHtml,
      fileName: 'status.mk.md',
      packStylesheets: [stylesheet],
    });

    // The component rendered as itself...
    expect(document).toContain('ana-timeline');
    expect(document).toContain('Timeline: Launch');
    // ...its stylesheet is embedded...
    expect(document).toContain('.ana-timeline { border: 1px solid');
    expect(document).toContain('pack: ana');
    // ...and the unknown-component fallback never appears in the rendered
    // body (doc.css legitimately defines `.mk-unknown`'s own styling, so
    // the check is scoped to the body markup this test produced, not the
    // whole document).
    expect(bodyHtml).not.toContain('mk-unknown');
    expect(bodyHtml).not.toContain('unknown component');
  });

  it('falls back to the unknown-component box for the SAME note through the static engine, proving the difference the React path makes', async () => {
    const { renderMarkToHtml } = await import('@markii/html');
    const { defaultHtmlRegistry } = await import('@markii/html/components');
    const bodyHtml = renderMarkToHtml(
      '::ana-timeline{title="Launch"}',
      defaultHtmlRegistry,
    );
    expect(bodyHtml).toContain('unknown component');
  });
});
