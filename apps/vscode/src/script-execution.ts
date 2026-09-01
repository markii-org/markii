/**
 * The device-level script-execution switch (`markii.scriptsDisabled`) and
 * every sentence it can produce.
 *
 * WHAT IT IS. A single off switch for the Run path. When it is on, no
 * trigger runs a note's scripts: not the manual `markii.runScripts` press,
 * not `markii.runOnOpen`, not the `markii.refreshIntervalSeconds` timer.
 * It is a convenience for a machine where scripting is simply not wanted,
 * sitting on top of the existing guarantees rather than replacing any of
 * them: the tier gate, the grant model, and the isolate are unchanged, and
 * turning this on never touches a stored grant. Turning it back off leaves
 * the same grants in place, so nothing is silently re-authorized either.
 *
 * WHY USER SCOPE. `package.json` pins the setting to `application` scope,
 * so a repository's own `.vscode/settings.json` cannot set it. Both
 * directions matter: a workspace must not be able to turn scripting ON for
 * a reader who turned it off. `contributes-runopen-scope.probe.test.ts` is
 * the executable half of that.
 *
 * WHY THE WORDING LIVES HERE. `preview-panel.ts` imports `vscode` and is
 * therefore not unit-testable, so every user-visible string and every
 * decision about which surface a blocked trigger reaches lives in this
 * plain module instead (`extension.ts`'s file-scope note).
 */
import type { RunTrigger } from '@markii/runtime';

/**
 * What a blocked MANUAL run says. Two short sentences: what happened, and
 * where to change it. The reason is the whole message, so nothing is
 * hidden behind a diagnostics lookup for the one trigger a user is
 * actively watching.
 */
export const SCRIPTS_DISABLED_NOTICE =
  'Markii: script execution is off on this device. Turn it on in the Markii settings to run this note.';

/** What the toggle command says once script execution is off. */
export const SCRIPTS_DISABLED_CONFIRMATION =
  'Markii: script execution turned OFF. No note runs its scripts on this device until you turn it back on.';

/** What the toggle command says once script execution is on again. Says what did NOT change, since the honest answer to "did this re-grant anything" is no. */
export const SCRIPTS_ENABLED_CONFIRMATION =
  'Markii: script execution turned ON. Your existing grants are unchanged, so a note still prompts for any host it has not been granted.';

/**
 * The notice a blocked run shows, or `undefined` for a trigger that shows
 * none.
 *
 * Only `'manual'` gets a popup. An `'auto'` run happens on every preview
 * open and a `'scheduled'` one happens on a timer, so notifying for those
 * would be a drip of identical popups reporting a state the user set
 * themselves. They are not silent, though: `scriptsDisabledDiagnosticLine`
 * below writes every blocked trigger to the Markii output channel, this
 * extension's designated diagnostics surface, so "why did my dashboard
 * stop refreshing" has an answer that does not require developer tools.
 */
export function scriptsDisabledNotice(trigger: RunTrigger): string | undefined {
  return trigger === 'manual' ? SCRIPTS_DISABLED_NOTICE : undefined;
}

/**
 * The Markii output channel line for one blocked run, whatever its
 * trigger. A blocked `'scheduled'` run also says that the preview's
 * refresh timer was stopped, because that is what `preview-panel.ts` does
 * with it: leaving a timer ticking against a closed door would write this
 * same line every interval for as long as the preview stayed open.
 */
export function scriptsDisabledDiagnosticLine(trigger: RunTrigger): string {
  const blocked = `run (${trigger}) blocked: markii.scriptsDisabled is on, so no scripts ran.`;
  return trigger === 'scheduled'
    ? `${blocked} This preview's scheduled refresh was stopped; reopen the preview to resume it.`
    : blocked;
}

/** The Markii output channel line for a preview that opens with a refresh interval configured but script execution off, so the timer is never started. */
export const SCHEDULED_REFRESH_NOT_STARTED_LINE =
  'scheduled refresh not started: markii.scriptsDisabled is on.';
