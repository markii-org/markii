/**
 * A REAL pack shipped as `.tsx` source that imports a relative helper
 * module with NO extension — the real-vault shape (`markii-vault`'s
 * `examples/02-hn-pulse/pack`, `examples/03-cat-gallery/pack`, both of
 * which import `./guard` this way) that exposed the regression
 * `./pack-build.ts`'s `virtualSourcePlugin` now resolves for real, instead
 * of only knowing the declared component + statically-scanned CSS.
 *
 * `./helper` (no extension) is `helper.ts`, which itself imports a further
 * helper (`./deep`, also extensionless) AND a directory `index` import
 * (`./util`, resolving to `util/index.ts`) AND its own CSS
 * (`./helper.css`) — a NON-entry module importing CSS, the shape the old
 * static-regex-over-declared-components-only CSS scan could never see.
 */
import { useState } from 'react';
import type { MarkComponentProps } from '@markii/react';
import { helperValue } from './helper';

export function Stat({ attributes, children }: MarkComponentProps) {
  const [count] = useState(0);
  return (
    <>
      <span
        className="mk-tsxhelpers-stat"
        data-label={attributes.label ?? 'stat'}
        data-helper={helperValue()}
      >
        {count}
      </span>
      {children}
    </>
  );
}
