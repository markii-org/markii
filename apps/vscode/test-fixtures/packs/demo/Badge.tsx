/**
 * The "demo" exemplar pack's one component, in source form — what
 * `pack.json`'s `components.badge` names (docs/packs.md: "A pack is an
 * npm-ish folder: a manifest plus component sources").
 *
 * This file is never read or compiled by the VS Code extension itself: the
 * extension only loads a pack's prebuilt `webview.js` (see that file's own
 * doc comment for the registration convention). This source exists so the
 * fixture is a COMPLETE, honest pack shape — the file a real bundler would
 * compile `webview.js` from — and so a reader comparing the two sees
 * exactly how they correspond.
 */
import type { MarkComponentProps } from '@markii/react';

export function Badge({ attributes, children }: MarkComponentProps) {
  const label = attributes.label ?? 'demo';
  return (
    <span className="mk-demo-badge" data-label={label}>
      {children}
    </span>
  );
}
