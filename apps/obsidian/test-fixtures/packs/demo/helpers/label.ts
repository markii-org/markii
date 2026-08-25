/**
 * A relative helper module imported by `../Badge.tsx` with no extension
 * (`import { formatLabel } from './helpers/label'`) — the shape
 * `resolveImportCandidate` in `@markii/host`'s `packs/pack-build.ts`
 * resolves by trying `.tsx`/`.ts`/`.jsx`/`.js`/`.mjs`/`.cjs`/`.css` in
 * turn. A distinctive marker string proves this file's own code (not just
 * `Badge.tsx`) made it into the compiled output.
 */
export function formatLabel(label: string): string {
  return `demo-fixture-marker-7c1a:${label}`;
}
