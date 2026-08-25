/**
 * A shared helper module imported by `./Stat.tsx` with NO extension
 * (`import { helperValue } from './helper'`) — the shape
 * `resolveImportCandidate` in `../../../src/packs/pack-build.ts` resolves
 * by trying `.tsx`/`.ts`/`.jsx`/`.js`/`.mjs`/`.cjs`/`.css` in turn.
 *
 * Imports a FURTHER helper (`./deep`, also extensionless) and a directory
 * `index` import (`./util`, resolving to `util/index.ts`), and imports its
 * OWN CSS (`./helper.css`) — a non-entry module pulling in a stylesheet,
 * which the pre-build static CSS scan (which only looks at the manifest's
 * declared component sources) never sees; only the real dynamic resolution
 * this fixture exercises discovers it.
 */
import { deepValue } from './deep';
import { utilValue } from './util';
import './helper.css';

export function helperValue(): string {
  return `${deepValue()}-${utilValue()}`;
}
