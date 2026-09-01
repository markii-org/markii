import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunTrigger } from '@markii/runtime';
import {
  SCHEDULED_REFRESH_NOT_STARTED_LINE,
  SCRIPTS_DISABLED_CONFIRMATION,
  SCRIPTS_DISABLED_NOTICE,
  SCRIPTS_ENABLED_CONFIRMATION,
  scriptsDisabledDiagnosticLine,
  scriptsDisabledNotice,
} from './script-execution.js';

/** Every trigger the Run path has — the gate has to answer for all three, not just the one a user presses. */
const TRIGGERS: readonly RunTrigger[] = ['manual', 'auto', 'scheduled'];

describe('markii.scriptsDisabled notice wording (issue #34)', () => {
  it('is two short sentences: what happened, and where to change it', () => {
    expect(SCRIPTS_DISABLED_NOTICE).toBe(
      'Markii: script execution is off on this device. Turn it on in the Markii settings to run this note.',
    );
    const sentences = SCRIPTS_DISABLED_NOTICE.split('. ');
    expect(sentences).toHaveLength(2);
  });

  it('uses no em dash and no parentheses, in any string this module can show', () => {
    for (const text of [
      SCRIPTS_DISABLED_NOTICE,
      SCRIPTS_DISABLED_CONFIRMATION,
      SCRIPTS_ENABLED_CONFIRMATION,
    ]) {
      expect(text).not.toMatch(/[—–]/);
      expect(text).not.toMatch(/[()]/);
    }
  });

  it('says out loud that turning execution back on re-authorizes nothing', () => {
    expect(SCRIPTS_ENABLED_CONFIRMATION).toContain(
      'existing grants are unchanged',
    );
  });
});

describe('the gate answers for all three triggers', () => {
  it('notifies the trigger a user is watching, and only that one', () => {
    expect(scriptsDisabledNotice('manual')).toBe(SCRIPTS_DISABLED_NOTICE);
    expect(scriptsDisabledNotice('auto')).toBeUndefined();
    expect(scriptsDisabledNotice('scheduled')).toBeUndefined();
  });

  it('writes a diagnostics line for every trigger, so a blocked run is never mute', () => {
    for (const trigger of TRIGGERS) {
      const line = scriptsDisabledDiagnosticLine(trigger);
      expect(line).toContain(`run (${trigger}) blocked`);
      expect(line).toContain('markii.scriptsDisabled');
    }
  });

  it('says a blocked scheduled run stopped the timer, since that is what the panel does with it', () => {
    expect(scriptsDisabledDiagnosticLine('scheduled')).toContain(
      'refresh was stopped',
    );
    expect(scriptsDisabledDiagnosticLine('manual')).not.toContain('stopped');
    expect(scriptsDisabledDiagnosticLine('auto')).not.toContain('stopped');
  });

  it('has a line for a preview that opens with an interval configured but execution off', () => {
    expect(SCHEDULED_REFRESH_NOT_STARTED_LINE).toContain(
      'markii.scriptsDisabled',
    );
  });
});

/**
 * The gate is one `if` in `preview-panel.ts`, which imports `vscode` and
 * so cannot be unit-tested here. What CAN be pinned is that the `if` sits
 * at the single choke point every trigger passes through, rather than
 * being repeated per command where a fourth trigger could later miss it.
 */
describe('the gate sits at the one choke point every trigger passes through', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, 'preview-panel.ts'),
    'utf8',
  );

  it('blocks inside runWithTrigger, the shared body behind manual, auto, and scheduled runs', () => {
    const body = source.slice(source.indexOf('async function runWithTrigger('));
    expect(body).not.toBe('');
    const gate = body.indexOf('if (scriptsDisabled()) {');
    const spawn = body.indexOf('await runOnce({');
    expect(gate).toBeGreaterThan(-1);
    expect(spawn).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(spawn);
  });

  it('reads the setting fresh rather than caching it on the panel, so turning it on stops an open preview', () => {
    expect(source).toMatch(/function scriptsDisabled\(\): boolean \{/);
    expect(source).not.toMatch(/readonly scriptsDisabled/);
  });

  it('leaves the grant store alone: the gate returns before any grant flow is reached', () => {
    const body = source.slice(source.indexOf('async function runWithTrigger('));
    const gateEnd = body.indexOf('blockRun(preview, trigger);');
    expect(gateEnd).toBeGreaterThan(-1);
    expect(body.slice(0, gateEnd)).not.toContain('promptHost');
  });
});
