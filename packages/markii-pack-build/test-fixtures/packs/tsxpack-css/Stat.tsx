/**
 * A REAL pack shipped as `.tsx` source that also imports its own CSS
 * (`import './Stat.css'`) — the exact "packs style themselves" shape
 * `../../../src/packs/pack-build.ts`'s stylesheet-emission slice exists
 * for. Otherwise identical to `../tsxpack/Stat.tsx` (see that file's doc
 * comment for the lazy-React contract this also exercises).
 */
import { useState } from 'react';
import type { MarkComponentProps } from '@markii/react';
import './Stat.css';

export function Stat({ attributes, children }: MarkComponentProps) {
  const [count] = useState(0);
  return (
    <>
      <span className="mk-tsxcss_stat" data-label={attributes.label ?? 'stat'}>
        {count}
      </span>
      {children}
    </>
  );
}
