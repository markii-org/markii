import { describe, expect, it } from 'vitest';
import type { RunTrigger } from '@markii/runtime';
import { CLI_LABELS, OBSIDIAN_LABELS, VSCODE_LABELS } from './labels.js';
import type { HostLabels } from './adapter.js';
import {
  scheduledRefreshNotStartedLine,
  scriptsDisabledConfirmationText,
  scriptsDisabledDiagnosticLine,
  scriptsDisabledNotice,
  scriptsDisabledNoticeText,
  scriptsEnabledConfirmationText,
} from './script-execution.js';

/** Every trigger the Run path has — the gate has to answer for all three, not just the one a user presses. */
const TRIGGERS: readonly RunTrigger[] = ['manual', 'auto', 'scheduled'];
const ALL_LABELS: readonly HostLabels[] = [
  VSCODE_LABELS,
  OBSIDIAN_LABELS,
  CLI_LABELS,
];

describe('scriptsDisabled notice wording (issue #34, merged from both apps)', () => {
  it('is two short sentences: what happened, and where to change it', () => {
    const text = scriptsDisabledNoticeText(VSCODE_LABELS);
    expect(text).toBe(
      'Markii: script execution is off on this device. Turn it on in the Markii settings to run this note.',
    );
    expect(text.split('. ')).toHaveLength(2);
  });

  it('reproduces both apps existing wording byte-exactly for the notice, since both already said "this device"', () => {
    expect(scriptsDisabledNoticeText(VSCODE_LABELS)).toBe(
      scriptsDisabledNoticeText(OBSIDIAN_LABELS),
    );
  });

  it('uses no em dash and no parentheses in the user-facing notice/confirmation wording', () => {
    for (const labels of ALL_LABELS) {
      for (const text of [
        scriptsDisabledNoticeText(labels),
        scriptsDisabledConfirmationText(labels),
        scriptsEnabledConfirmationText(labels),
      ]) {
        expect(text).not.toMatch(/[—–]/);
        expect(text).not.toMatch(/[()]/);
      }
    }
  });

  it('uses no em dash in a diagnostics line either (parentheses are fine there: `(trigger)`/`(kind)` tags are the established diagnostics-line convention)', () => {
    for (const labels of ALL_LABELS) {
      expect(scheduledRefreshNotStartedLine(labels)).not.toMatch(/[—–]/);
      for (const trigger of TRIGGERS) {
        expect(scriptsDisabledDiagnosticLine(trigger, labels)).not.toMatch(
          /[—–]/,
        );
      }
    }
  });

  it('says out loud that turning execution back on re-authorizes nothing', () => {
    expect(scriptsEnabledConfirmationText(VSCODE_LABELS)).toContain(
      'existing grants are unchanged',
    );
  });

  it('interpolates the device noun into the ON/OFF confirmations', () => {
    expect(scriptsDisabledConfirmationText(VSCODE_LABELS)).toBe(
      'Markii: script execution turned OFF on this device. No note runs its scripts until you turn it back on.',
    );
    expect(scriptsEnabledConfirmationText(VSCODE_LABELS)).toBe(
      'Markii: script execution turned ON for this device. Your existing grants are unchanged, so a note still prompts for any host it has not been granted.',
    );
  });
});

describe('the gate answers for all three triggers', () => {
  it('notifies the trigger a user is watching, and only that one', () => {
    expect(scriptsDisabledNotice('manual', VSCODE_LABELS)).toBe(
      scriptsDisabledNoticeText(VSCODE_LABELS),
    );
    expect(scriptsDisabledNotice('auto', VSCODE_LABELS)).toBeUndefined();
    expect(scriptsDisabledNotice('scheduled', VSCODE_LABELS)).toBeUndefined();
  });

  it('writes a diagnostics line for every trigger, so a blocked run is never mute', () => {
    for (const trigger of TRIGGERS) {
      const line = scriptsDisabledDiagnosticLine(trigger, VSCODE_LABELS);
      expect(line).toContain(`run (${trigger}) blocked`);
      expect(line).toContain('script execution is off');
    }
  });

  it('says a blocked scheduled run stopped the timer, since that is what a preview does with it, on every host', () => {
    for (const labels of ALL_LABELS) {
      expect(scriptsDisabledDiagnosticLine('scheduled', labels)).toContain(
        'refresh was stopped',
      );
      expect(scriptsDisabledDiagnosticLine('manual', labels)).not.toContain(
        'stopped',
      );
      expect(scriptsDisabledDiagnosticLine('auto', labels)).not.toContain(
        'stopped',
      );
    }
  });

  it('has a line for a preview that opens with an interval configured but execution off', () => {
    expect(scheduledRefreshNotStartedLine(VSCODE_LABELS)).toContain(
      'scheduled refresh not started',
    );
  });

  it("names VS Code's exact setting in every diagnostics line, so a user can find the switch without developer tools", () => {
    expect(scriptsDisabledDiagnosticLine('manual', VSCODE_LABELS)).toBe(
      'run (manual) blocked: script execution is off on this device (markii.scriptsDisabled).',
    );
    expect(scriptsDisabledDiagnosticLine('auto', VSCODE_LABELS)).toBe(
      'run (auto) blocked: script execution is off on this device (markii.scriptsDisabled).',
    );
    expect(scriptsDisabledDiagnosticLine('scheduled', VSCODE_LABELS)).toBe(
      "run (scheduled) blocked: script execution is off on this device (markii.scriptsDisabled). This preview's scheduled refresh was stopped; reopen the preview to resume it.",
    );
    expect(scheduledRefreshNotStartedLine(VSCODE_LABELS)).toBe(
      'scheduled refresh not started: script execution is off on this device (markii.scriptsDisabled).',
    );
  });

  it('a host with no settingName (Obsidian, the CLI) keeps the plain sentence, with no parentheses', () => {
    for (const labels of [OBSIDIAN_LABELS, CLI_LABELS]) {
      expect(scriptsDisabledDiagnosticLine('manual', labels)).toBe(
        'run (manual) blocked: script execution is off on this device.',
      );
      expect(scheduledRefreshNotStartedLine(labels)).toBe(
        'scheduled refresh not started: script execution is off on this device.',
      );
      expect(scriptsDisabledDiagnosticLine('manual', labels)).not.toContain(
        'scriptsDisabled',
      );
    }
  });

  it('never bakes a sink-specific prefix (like "[markii]") into the wording itself', () => {
    for (const labels of ALL_LABELS) {
      expect(scheduledRefreshNotStartedLine(labels)).not.toMatch(/^\[/);
      for (const trigger of TRIGGERS) {
        expect(scriptsDisabledDiagnosticLine(trigger, labels)).not.toMatch(
          /^\[/,
        );
      }
    }
  });
});
