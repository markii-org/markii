/** Lives OUTSIDE `../tsxpack-jailbreak/`, the pack folder that imports it — the file the jail check in `./pack-build.ts` must refuse to load. */
export function secretValue(): string {
  return 'should-never-be-bundled';
}
