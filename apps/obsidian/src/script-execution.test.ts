import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunTrigger } from '@markii/runtime';
import {
  OBSIDIAN_LABELS,
  scheduledRefreshNotStartedLine,
  scriptsDisabledConfirmationText,
  scriptsDisabledDiagnosticLine,
  scriptsDisabledNotice,
  scriptsDisabledNoticeText,
  scriptsEnabledConfirmationText,
} from '@markii/host';

/**
 * Batch 11: the wording itself (`scriptsDisabledNoticeText` and friends)
 * moved into `@markii/host`'s `host/script-execution.ts`, and is tested
 * there. What stays worth pinning HERE is this host's own piece: that
 * `OBSIDIAN_LABELS` produces exactly the sentences this plugin has always
 * shown (a wording regression here would be silent to every other host's
 * test suite), and that `src/view.tsx`'s gate still sits at the one choke
 * point every trigger passes through.
 */

/** Every trigger the Run path has — the gate has to answer for all three, not just the one a user presses. */
const TRIGGERS: readonly RunTrigger[] = ['manual', 'auto', 'scheduled'];

describe("OBSIDIAN_LABELS produces this host's exact wording (issue #34)", () => {
  it('is two short sentences: what happened, and where to change it', () => {
    expect(scriptsDisabledNoticeText(OBSIDIAN_LABELS)).toBe(
      'Markii: script execution is off on this device. Turn it on in the Markii settings to run this note.',
    );
    expect(scriptsDisabledNoticeText(OBSIDIAN_LABELS).split('. ')).toHaveLength(
      2,
    );
  });

  it('uses no em dash and no parentheses, in any string this host can show', () => {
    for (const text of [
      scriptsDisabledNoticeText(OBSIDIAN_LABELS),
      scriptsDisabledConfirmationText(OBSIDIAN_LABELS),
      scriptsEnabledConfirmationText(OBSIDIAN_LABELS),
    ]) {
      expect(text).not.toMatch(/[—–]/);
      expect(text).not.toMatch(/[()]/);
    }
  });

  it('says out loud that turning execution back on re-authorizes nothing', () => {
    expect(scriptsEnabledConfirmationText(OBSIDIAN_LABELS)).toContain(
      'existing grants are unchanged',
    );
  });
});

describe('the gate answers for all three triggers, worded for this host', () => {
  it('notifies the trigger a user is watching, and only that one', () => {
    expect(scriptsDisabledNotice('manual', OBSIDIAN_LABELS)).toBe(
      scriptsDisabledNoticeText(OBSIDIAN_LABELS),
    );
    expect(scriptsDisabledNotice('auto', OBSIDIAN_LABELS)).toBeUndefined();
    expect(scriptsDisabledNotice('scheduled', OBSIDIAN_LABELS)).toBeUndefined();
  });

  it('writes a diagnostics-surface line for every trigger, so a blocked run is never mute', () => {
    for (const trigger of TRIGGERS) {
      const line = scriptsDisabledDiagnosticLine(trigger, OBSIDIAN_LABELS);
      expect(line).toContain(`run (${trigger}) blocked`);
      // The `[markii] ` prefix is this host's console SINK's job
      // (`src/host-adapter.ts`'s `diagnostics`), never baked into the
      // shared wording — see that file's test for the prefix itself.
      expect(line.startsWith('[markii]')).toBe(false);
    }
  });

  it('has a line for a preview that opens with an interval configured but execution off', () => {
    expect(scheduledRefreshNotStartedLine(OBSIDIAN_LABELS)).toContain(
      'scheduled refresh not started',
    );
  });
});

/**
 * The gate itself is one `if` in `src/view.tsx`, which imports `obsidian`
 * and so cannot run under Vitest. What CAN be pinned is that the `if` sits
 * at the single choke point every trigger passes through (rather than
 * being repeated per caller, where a fourth trigger could later miss it),
 * and that it returns before any grant flow is reached.
 */
describe('the gate sits at the one choke point every trigger passes through', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'view.tsx'), 'utf8');
  const runScripts = source.slice(
    source.indexOf('async runScripts(trigger: RunTrigger)'),
  );

  it('blocks inside runScripts, the shared body behind manual, auto, and scheduled runs', () => {
    expect(runScripts).not.toBe('');
    const gate = runScripts.indexOf(
      'if (this.plugin.localSettings.scriptsDisabled) {',
    );
    const spawn = runScripts.indexOf('await runViaAdapter(');
    expect(gate).toBeGreaterThan(-1);
    expect(spawn).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(spawn);
  });

  it('leaves the grant store alone: the gate returns before any prompt adapter is reached', () => {
    const gateEnd = runScripts.indexOf('scriptsDisabledNotice(trigger');
    expect(gateEnd).toBeGreaterThan(-1);
    expect(runScripts.slice(0, gateEnd)).not.toContain('createObsidianPrompt');
  });

  it('reads the live device-local settings, so turning it on stops an already-open preview', () => {
    expect(runScripts).toContain('this.plugin.localSettings.scriptsDisabled');
  });
});

/**
 * The storage tier is the point of this setting living in
 * `local-settings.ts`: it decides whether code runs, so a vault-synced
 * copy would carry one device's execution decision to every other device
 * and to anyone the vault is shared with. `src/storage-boundary.test.ts`
 * guards the `saveData` half; this guards the placement half, which that
 * test cannot see.
 */
describe('scriptsDisabled is device-local, not vault-synced', () => {
  const here = import.meta.dirname;

  it('is declared in local-settings.ts and nowhere in settings.ts', () => {
    expect(readFileSync(resolve(here, 'local-settings.ts'), 'utf8')).toContain(
      'scriptsDisabled',
    );
    expect(readFileSync(resolve(here, 'settings.ts'), 'utf8')).not.toContain(
      'scriptsDisabled',
    );
  });

  it('is written through saveLocalSettings, never saveSettings', () => {
    for (const file of ['settings-tab.ts', 'main.ts']) {
      const source = readFileSync(resolve(here, file), 'utf8');
      const index = source.indexOf('scriptsDisabled: ');
      if (index === -1) continue;
      // The nearest write call above the key must be the device-local one.
      const before = source.slice(0, index);
      expect(before.lastIndexOf('saveLocalSettings(')).toBeGreaterThan(
        before.lastIndexOf('saveSettings('),
      );
    }
  });
});
