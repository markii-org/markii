/**
 * Fixture pack for `src/packs/pack-context.fixture.test.ts`: a REAL `.tsx`
 * component, importing its own CSS (`./Badge.css`) AND a relative helper
 * module with no extension (`./helpers/label`) — deliberately NOT a flat
 * single-file pack, since that shape is exactly what let a resolution
 * regression through in `@markii/host`'s `packs/pack-build.ts` (see that
 * package's `test-fixtures/packs/tsxpack-helpers/` fixture, which this one
 * mirrors). Compiled by the real `buildPackRegistrationScript` (in a
 * separate `node` process — see the fixture test's top doc comment for
 * why), then evaluated in-process via `src/packs/pack-runtime.ts`, the
 * same path a real vault takes.
 */
import { useState } from 'react';
import type { MarkComponentProps } from '@markii/react';
import { formatLabel } from './helpers/label';
import './Badge.css';

export function Badge({ attributes, children }: MarkComponentProps) {
  const [count] = useState(0);
  return (
    <>
      <span className="mk-demo-badge" data-count={count}>
        {formatLabel(attributes.label ?? 'badge')}
      </span>
      {children}
    </>
  );
}
