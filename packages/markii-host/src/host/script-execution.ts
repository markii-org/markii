/**
 * The device-level script-execution switch and every sentence it can
 * produce, merged from `apps/vscode/src/script-execution.ts` and
 * `apps/obsidian/src/script-execution.ts` (survey finding A4: same file
 * name, same four exports, doc comments sharing the same "WHAT IT IS /
 * WHY DEVICE-LOCAL / WHY THE WORDING LIVES HERE" structure, differing
 * only in a handful of words).
 *
 * WHAT IT IS. A single off switch for the Run path. When it is on, no
 * trigger runs a note's scripts: not a manual run press, not run-on-open,
 * not the scheduled-refresh timer. It sits on top of the existing
 * guarantees rather than replacing any of them: the tier gate, the grant
 * model, and the isolate are unchanged, and turning it on never touches a
 * stored grant. Turning it back off leaves the same grants in place, so
 * nothing is silently re-authorized either.
 *
 * WHY DEVICE-LOCAL. It decides whether code runs, so every host persists
 * it outside anything that syncs or travels with a shared file: never
 * VS Code's workspace-shared settings, never Obsidian's vault-synced
 * `saveData`. Each app's own storage-boundary test is the executable half
 * of that rule.
 *
 * WHY THE WORDING LIVES HERE. The files that wire this switch to a real
 * UI (`preview-panel.ts`, `view.tsx`, `main.ts`) import their host's
 * platform module and are therefore not unit-testable, so every
 * user-visible string and every decision about which surface a blocked
 * trigger reaches lives in this plain, host-labeled module instead.
 *
 * Pure and dependency-free: re-exported from `../browser.ts` as well as
 * `../index.ts`.
 */
import type { RunTrigger } from '@markii/runtime';
import type { HostLabels } from './adapter.js';

/**
 * What a blocked MANUAL run says. Two short sentences: what happened, and
 * where to change it. The reason is the whole message, so nothing is
 * hidden behind a diagnostics lookup for the one trigger a user is
 * actively watching.
 */
export function scriptsDisabledNoticeText(labels: HostLabels): string {
  return `Markii: script execution is off on ${labels.deviceNoun}. Turn it on in the Markii settings to run this note.`;
}

/** What the toggle command says once script execution is off. */
export function scriptsDisabledConfirmationText(labels: HostLabels): string {
  return `Markii: script execution turned OFF on ${labels.deviceNoun}. No note runs its scripts until you turn it back on.`;
}

/** What the toggle command says once script execution is on again. Says what did NOT change, since the honest answer to "did this re-grant anything" is no. */
export function scriptsEnabledConfirmationText(labels: HostLabels): string {
  return `Markii: script execution turned ON for ${labels.deviceNoun}. Your existing grants are unchanged, so a note still prompts for any host it has not been granted.`;
}

/**
 * The notice a blocked run shows, or `undefined` for a trigger that shows
 * none.
 *
 * Only `'manual'` gets a popup or notice. An `'auto'` run happens on every
 * preview open and a `'scheduled'` one happens on a timer, so notifying
 * for those would be a drip of identical notices reporting a state the
 * user set themselves. They are not silent, though:
 * `scriptsDisabledDiagnosticLine` below writes every blocked trigger to
 * this host's designated diagnostics surface, so "why did my dashboard
 * stop refreshing" has an answer that does not require developer tools.
 */
export function scriptsDisabledNotice(
  trigger: RunTrigger,
  labels: HostLabels,
): string | undefined {
  return trigger === 'manual' ? scriptsDisabledNoticeText(labels) : undefined;
}

/**
 * The clause naming why script execution is off, with the exact setting a
 * user would toggle when this host has one (`labels.settingName`) — this
 * is the diagnostics surface, the FULL-DETAIL home for a failure
 * (AGENTS.md: "could a user, without opening developer tools ... discover
 * that this failed and why?"), so it names the switch, not just the
 * state. A host with no single named setting (a command or toggle
 * instead) gets the plain sentence.
 */
function scriptExecutionOffClause(labels: HostLabels): string {
  return labels.settingName === undefined
    ? `script execution is off on ${labels.deviceNoun}`
    : `script execution is off on ${labels.deviceNoun} (${labels.settingName})`;
}

/**
 * The diagnostics-surface line for one blocked run, whatever its trigger.
 * A blocked `'scheduled'` run also says that the preview's refresh timer
 * was stopped: leaving a timer ticking against a closed door would write
 * this same line every interval for as long as the preview stayed open.
 *
 * Names this host's own setting when it has one (`labels.settingName`),
 * so the same sentence still reads correctly from any host's diagnostics
 * surface while telling a VS Code user exactly which setting to flip back.
 * Any sink-specific prefix, such as a `[markii]` console tag, is the
 * adapter's own `diagnostics(line)` call's job to add, never baked in here.
 */
export function scriptsDisabledDiagnosticLine(
  trigger: RunTrigger,
  labels: HostLabels,
): string {
  const blocked = `run (${trigger}) blocked: ${scriptExecutionOffClause(labels)}.`;
  return trigger === 'scheduled'
    ? `${blocked} This preview's scheduled refresh was stopped; reopen the preview to resume it.`
    : blocked;
}

/** The diagnostics-surface line for a preview that opens with a refresh interval configured but script execution off, so the timer is never started. */
export function scheduledRefreshNotStartedLine(labels: HostLabels): string {
  return `scheduled refresh not started: ${scriptExecutionOffClause(labels)}.`;
}
