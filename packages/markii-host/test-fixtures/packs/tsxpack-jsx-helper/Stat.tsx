/**
 * The declared component (the compiler's ENTRY module). Renders through
 * `./Badge.tsx`, a non-entry helper that has its own JSX — the exact shape
 * this fixture exists to exercise (see `Badge.tsx`'s doc comment).
 */
import type { MarkComponentProps } from '@markii/react';
import { Badge } from './Badge';

export function Stat({ attributes, children }: MarkComponentProps) {
  return (
    <>
      <Badge label={attributes.label ?? 'stat'} />
      {children}
    </>
  );
}
