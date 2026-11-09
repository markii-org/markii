/**
 * A minimal, REAL pack shipped only as `.tsx` source (no prebuilt
 * `webview.js`) — the exact shape GitHub issue #3's compile-from-source
 * slice exists for (see `../../../src/packs/pack-build.ts`'s top doc
 * comment). Unlike `../demo` (which ships a hand-written `webview.js`
 * standing in for a build step), this fixture has NO such file: it exists
 * so `pack-build.test.ts` and `fixture-integration.test.ts` can compile a
 * real component end to end with the real esbuild-wasm.
 *
 * Deliberately exercises both halves of the lazy-React contract
 * (`pack-build.ts`'s doc comment): JSX (a fragment, even, so
 * `__markiiJSX.Fragment` gets exercised too) AND a named hook import
 * (`useState`) from `react`.
 */
import { useState } from 'react';
import type { MarkComponentProps } from '@markii/react';

export function Stat({ attributes, children }: MarkComponentProps) {
  const [count] = useState(0);
  return (
    <>
      <span className="mk-tsxpack-stat" data-label={attributes.label ?? 'stat'}>
        {count}
      </span>
      {children}
    </>
  );
}
