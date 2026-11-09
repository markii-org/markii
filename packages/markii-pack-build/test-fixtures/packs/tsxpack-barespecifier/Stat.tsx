/**
 * A pack component that imports a bare package specifier other than
 * `react`/`react-dom` (`left-pad`, which is not installed and never
 * would be — packs are self-contained by contract, no `node_modules`
 * dependency of their own) — proves `virtualSourcePlugin` rejects it with
 * a clear, recorded reason instead of falling through to esbuild's own
 * filesystem-less default resolver.
 */
import type { MarkComponentProps } from '@markii/react';
import { leftPad } from 'left-pad';

export function Stat({ attributes, children }: MarkComponentProps) {
  return (
    <span className="mk-tsxbarespecifier-stat">
      {leftPad(String(attributes.label ?? ''), 4)}
      {children}
    </span>
  );
}
