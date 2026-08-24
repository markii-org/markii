/**
 * The pure list-merge behind the `markii.addPackFolder` command (a folder
 * picker that appends to the `markii.packs` setting). `vscode`-free and pure
 * so the dedupe/append rule is unit-tested without a real settings store;
 * `extension.ts` owns the picker and the `getConfiguration().update` call.
 */

/**
 * Appends `folderPath` to the existing `markii.packs` list, de-duplicated by
 * exact string match. Returns the new list, or `undefined` when the folder is
 * already present so the caller can skip the config write (and tell the user
 * there was nothing to add) rather than writing an identical value.
 */
export function appendPackFolder(
  existing: readonly string[],
  folderPath: string,
): string[] | undefined {
  if (existing.includes(folderPath)) return undefined;
  return [...existing, folderPath];
}
