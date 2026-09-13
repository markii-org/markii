import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `preview-panel.ts` imports `vscode` and so cannot be unit-tested here
 * directly. What CAN be pinned, the same way `script-execution.test.ts`
 * pinned it before the `markii.scriptsDisabled` gate's wording moved to
 * `@markii/host` (batch 11): the device-level script-execution switch
 * sits at the ONE choke point every trigger (`manual`/`auto`/`scheduled`)
 * passes through, ahead of any grant prompt or `runOnce` call, rather than
 * being repeated per command where a fourth trigger could later miss it.
 */
describe('the scriptsDisabled gate sits at the one choke point every trigger passes through', () => {
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
    expect(body.slice(0, gateEnd)).not.toContain('promptsFromAdapter');
  });
});
