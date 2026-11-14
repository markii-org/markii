/**
 * Pack discovery through `createMarkiiHost(adapter).loadPacks()`: the one
 * way this extension reads a list of pack folders. The folder list itself
 * is this host's policy (the resolved `markii.packs` setting, the bundled
 * `dist/packs`, a folder a user is adding), so each call hands the adapter
 * exactly the folders it wants read. `vscode`-free.
 *
 * The host's own diagnostics lines are not written here. Every caller
 * reports what it found, and why a folder was skipped, through its own
 * diagnostics lines (`./pack-diagnostics.ts`, `./validate-pack-folder.ts`),
 * which also cover facts discovery cannot see, so a quiet sink avoids
 * writing each discovery twice.
 */
import { createMarkiiHost } from '@markii/host';
import type { GrantMemento, LoadPacksOutcome } from '@markii/host';
import { createVSCodeHostAdapter } from '../host-adapter.js';

/** Discovery never stores anything, so its memento holds nothing. */
const EMPTY_MEMENTO: GrantMemento = {
  get: <T>(_key: string, defaultValue?: T) => defaultValue as T,
  update: () => Promise.resolve(),
};

type LoadedPacks = Extract<LoadPacksOutcome, { kind: 'loaded' }>;

/** What the shared host finds under `folders`, engine-gated for the preview. Nothing found is the empty result, never a throw. */
export async function discoverFoldersViaHost(
  folders: readonly string[],
): Promise<Pick<LoadedPacks, 'packs' | 'skipped' | 'components'>> {
  const outcome = await createMarkiiHost(
    createVSCodeHostAdapter({
      memento: EMPTY_MEMENTO,
      prompt: async () => false,
      diagnostics: () => undefined,
      authorizedFolders: async () => folders,
    }),
  ).loadPacks();
  return outcome.kind === 'loaded'
    ? outcome
    : { packs: [], skipped: [], components: [] };
}
