/**
 * The shared wording templates a host's shared behaviors interpolate
 * `HostLabels` into live beside each behavior. This module holds the one
 * label sentence that has no per-host noun. Each app owns its own
 * `HostLabels` record and passes it as `HostAdapter.labels`.
 *
 * Pure and dependency-free.
 */

/**
 * The quiet marker a rendered note shows when its `uses:` list names packs
 * this host has not installed (docs/packs.md). One sentence for every host;
 * the tooltip beside it, which says how to install, stays host-specific.
 */
export function packsNotInstalledLabel(missing: readonly string[]): string {
  return missing.length === 1
    ? `Pack not installed: ${missing[0]}`
    : `Packs not installed: ${missing.join(', ')}`;
}

/** What a sentence calls a note when the host's labels do not say otherwise. */
export const DEFAULT_NOTE_NOUN = 'note';

/** The label a host may carry, read structurally so a plain string-only caller needs no `HostLabels`. */
export interface NoteNounSource {
  readonly noteNoun?: string;
}

/** The singular noun a sentence uses for the note: the host's `noteNoun`, else `note`. */
export function noteNounOf(labels?: NoteNounSource): string {
  const noun = labels?.noteNoun;
  return noun === undefined || noun.trim() === '' ? DEFAULT_NOTE_NOUN : noun;
}
