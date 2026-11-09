/**
 * The host-neutral half of loading TERMINAL packs (`terminal.js`, the
 * prebuilt terminal registration module beside `webview.js`). A host that
 * runs the terminal engine (`@markii/ansi`, which this package never
 * depends on) calls `createMarkiiHost`'s `loadTerminalPacks`, which
 * discovers the authorized packs and reads each one's `terminal.js` text
 * through this module; the host then hands the text to the engine's own
 * `loadTerminalPackScript`. Everything here is the one home of the wording
 * for the failures in between (docs/integration.md's "clean is not silent":
 * a failure reaches the diagnostics surface and the note shows the pack's
 * components as a failed pack).
 *
 * SECURITY: a terminal pack runs inside the host's own process with that
 * process's full privileges. Nothing here widens who may reach it: the
 * caller names the packs, and `HostPackSource.authorizedFolders()` is the
 * only way a folder becomes a candidate (never a note, a bundle, the
 * working directory, or an environment variable).
 */
import type { DiscoveredPack } from '../packs/discover.js';
import { prebuiltTerminalScriptPathFor } from '../packs/prebuilt.js';
import type { HostAdapter } from './adapter.js';

/** One pack's `terminal.js` text, ready for the terminal engine's loader. */
export interface TerminalPackScript {
  readonly namespace: string;
  readonly folder: string;
  readonly text: string;
}

export interface ReadTerminalScriptsResult {
  readonly scripts: readonly TerminalPackScript[];
  /** One line per pack that names `ansi` sources but whose `terminal.js` could not be read. */
  readonly problems: readonly string[];
}

/** Whether a discovered pack names at least one terminal (`ansi`) source. */
export function packHasTerminalViews(pack: DiscoveredPack): boolean {
  return Object.keys(pack.componentPathsByEngine?.['ansi'] ?? {}).length > 0;
}

export function terminalScriptMissingLine(namespace: string): string {
  return `Pack "${namespace}" names terminal views but ships no terminal.js; its components read as a failed pack in the note.`;
}

export function terminalScriptUnreadableLine(
  namespace: string,
  reason: string,
): string {
  return `Pack "${namespace}" has a terminal.js that could not be read (${reason}); its components read as a failed pack in the note.`;
}

export function terminalScriptRejectedLine(
  namespace: string,
  reason: string,
): string {
  return `Pack "${namespace}" was not loaded: ${reason}. Its components read as a failed pack in the note.`;
}

export function terminalScriptNamespaceMismatchLine(
  namespace: string,
  claimed: string,
): string {
  return `Pack "${namespace}" was not loaded: its terminal.js registers the namespace "${claimed}", which does not match its pack.json. Its components read as a failed pack in the note.`;
}

/** Reads each terminal-capable pack's `terminal.js`. Never throws. */
export async function readTerminalPackScripts(
  adapter: Pick<HostAdapter, 'exists' | 'readFile'>,
  packs: readonly DiscoveredPack[],
): Promise<ReadTerminalScriptsResult> {
  const scripts: TerminalPackScript[] = [];
  const problems: string[] = [];
  for (const pack of packs) {
    if (!packHasTerminalViews(pack)) continue;
    const namespace = pack.manifest.name;
    const scriptPath = prebuiltTerminalScriptPathFor(pack.folder);
    let present: boolean;
    try {
      present = await adapter.exists(scriptPath);
    } catch {
      present = false;
    }
    if (!present) {
      problems.push(terminalScriptMissingLine(namespace));
      continue;
    }
    try {
      const bytes = await adapter.readFile(scriptPath);
      scripts.push({
        namespace,
        folder: pack.folder,
        text: new TextDecoder().decode(bytes),
      });
    } catch (err) {
      problems.push(
        terminalScriptUnreadableLine(
          namespace,
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  }
  return { scripts, problems };
}
