/**
 * A pack component that imports a relative module OUTSIDE this pack's own
 * folder (`../tsxpack-jailbreak-outside/secret`, a sibling of
 * `tsxpack-jailbreak/` rather than something inside it) — proves
 * `virtualSourcePlugin`'s jail check (`./pack-build.ts`, task #2 in the
 * regression fix) refuses the import rather than silently pulling in a
 * file outside the pack, since packs are self-contained by contract.
 */
import type { MarkComponentProps } from '@markii/react';
import { secretValue } from '../tsxpack-jailbreak-outside/secret';

export function Stat({ attributes, children }: MarkComponentProps) {
  return (
    <span className="mk-tsxjailbreak-stat" data-label={attributes.label}>
      {secretValue()}
      {children}
    </span>
  );
}
