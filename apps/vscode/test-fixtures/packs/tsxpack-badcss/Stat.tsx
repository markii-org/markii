/**
 * Companion to `../tsxpack-css`, but its CSS (`./Stat.css`) deliberately
 * breaks both `../../../src/packs/pack-css-lint.ts` rules — see that
 * file's doc comment. Used only by `pack-build.fixture.test.ts`'s
 * warnings-firing assertion; never referenced by the render path.
 */
import { useState } from 'react';
import type { MarkComponentProps } from '@markii/react';
import './Stat.css';

export function Stat({ attributes, children }: MarkComponentProps) {
  const [count] = useState(0);
  return (
    <>
      <span className="stat" data-label={attributes.label ?? 'stat'}>
        {count}
      </span>
      {children}
    </>
  );
}
