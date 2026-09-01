/**
 * The device-local script-execution switch (`LocalSettings.scriptsDisabled`)
 * and every sentence it can produce.
 *
 * WHAT IT IS. A single off switch for the Run path on this device. When it
 * is on, no trigger runs a note's scripts: not the `run-markii-scripts`
 * command, not run-on-open, not the scheduled interval. It sits on top of
 * the existing guarantees rather than replacing any of them: the tier
 * gate, the grant model, and the Web Worker isolate are unchanged, and
 * turning it on never touches a stored grant. Turning it back off leaves
 * the same grants in place, so nothing is silently re-authorized either.
 *
 * WHY DEVICE-LOCAL. It decides whether code runs, so it is persisted with
 * `app.saveLocalStorage` alongside run-on-open and the refresh interval
 * (see `src/local-settings.ts`), never with `saveData`, which writes into
 * the vault and travels with Sync and with anyone the vault is shared
 * with. `src/storage-boundary.test.ts` is the executable half of that
 * rule.
 *
 * WHY THE WORDING LIVES HERE. `src/view.tsx`, `src/main.ts`, and
 * `src/settings-tab.ts` all import `obsidian` and are therefore not
 * unit-testable, so every user-visible string and every decision about
 * which surface a blocked trigger reaches lives in this plain module
 * instead (see `src/main.ts`'s file-scope note).
 */
import type { RunTrigger } from '@markii/runtime';

/**
 * What a blocked MANUAL run says. Two short sentences: what happened, and
 * where to change it. The reason is the whole message, so nothing is
 * hidden behind a console lookup for the one trigger a user is actively
 * watching.
 */
export const SCRIPTS_DISABLED_NOTICE =
  'Markii: script execution is off on this device. Turn it on in the Markii settings to run this note.';

/** What the toggle command says once script execution is off. */
export const SCRIPTS_DISABLED_CONFIRMATION =
  'Markii: script execution turned OFF on this device. No note runs its scripts until you turn it back on.';

/** What the toggle command says once script execution is on again. Says what did NOT change, since the honest answer to "did this re-grant anything" is no. */
export const SCRIPTS_ENABLED_CONFIRMATION =
  'Markii: script execution turned ON for this device. Your existing grants are unchanged, so a note still prompts for any host it has not been granted.';

/**
 * The notice a blocked run shows, or `undefined` for a trigger that shows
 * none.
 *
 * Only `'manual'` gets a `Notice`, which is the same split this host
 * already uses for run outcomes (`view.tsx`'s `reportRunOutcome`): an
 * `'auto'` run happens on every preview open and a `'scheduled'` one
 * happens on a timer, so notifying for those would be a drip of identical
 * notices reporting a state the user set themselves. They are not silent,
 * though: `scriptsDisabledDiagnosticLine` below goes to the developer
 * console, this host's designated diagnostics surface, for every blocked
 * trigger.
 */
export function scriptsDisabledNotice(trigger: RunTrigger): string | undefined {
  return trigger === 'manual' ? SCRIPTS_DISABLED_NOTICE : undefined;
}

/** The console line for one blocked run, whatever its trigger. */
export function scriptsDisabledDiagnosticLine(trigger: RunTrigger): string {
  return `[markii] run (${trigger}) blocked: script execution is off on this device.`;
}

/** The console line for a preview that opens with a refresh interval configured but script execution off, so the timer is never started. */
export const SCHEDULED_REFRESH_NOT_STARTED_LINE =
  '[markii] scheduled refresh not started: script execution is off on this device.';
