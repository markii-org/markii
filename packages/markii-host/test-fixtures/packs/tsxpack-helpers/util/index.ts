/** A directory `index` import: `./helper.ts` imports this as `./util` (no file name, no extension), which `resolveImportCandidate` resolves to `util/index.ts` after the exact-path and bare-extension candidates both miss. Its return value is a marker string a test asserts appears literally in the compiled output. */
export function utilValue(): string {
  return 'util-marker-2b7a';
}
