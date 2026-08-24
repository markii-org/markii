/**
 * ISSUE #12 PENTEST — dedicated adversarial pass on the auto-run/scheduled
 * surface (GitHub issue #11).
 *
 * Attacks item 5 of the issue-12 brief: whether a WORKSPACE-scoped
 * `markii.runOnOpen` (a repo's own `.vscode/settings.json`) can turn on
 * unattended script execution for someone who merely opens that repo, on a
 * fresh clone with no persisted grant of their own.
 *
 * ## What this file demonstrates
 *
 * `apps/vscode/src/contributes.test.ts` already pins `markii.packs` to
 * `"scope": "application"` (see its "H-1" describe block) SPECIFICALLY
 * because that one string in `package.json` is the entire mechanism that
 * keeps a workspace's `.vscode/settings.json` from silently loading a pack
 * folder for someone who just opened that repo — VS Code enforces
 * `application`-scope settings as USER settings only; they cannot be set at
 * the workspace or folder level at all.
 *
 * The pass found that `markii.runOnOpen` and `markii.refreshIntervalSeconds`
 * declared NO `"scope"` field at all. VS Code's documented default for an
 * omitted `scope` is `"window"`, NOT `"application"` — and a `"window"`-scope
 * setting CAN be set from a workspace's own `.vscode/settings.json`, taking
 * effect for anyone who opens that workspace, with no per-user opt-in gate of
 * the kind `markii.packs` gets. Both settings are now pinned to
 * `"scope": "application"`, and this file is the regression guard that keeps
 * them that way: the pin is one string in `package.json` with no other code
 * depending on it, exactly the kind of declaration that is silently lost in a
 * later edit.
 *
 * ## Why this matters (see also item 5's own framing in the brief)
 *
 * `markii.runOnOpen`'s own `markdownDescription` says an auto-run "never
 * prompts and never adds network access — it reuses only the hosts you
 * already granted by hand for that exact note", and `resolveStoredGrant`
 * genuinely enforces that (see `scheduled-grant-network.probe.test.ts` in
 * this same pass: an ungranted host gets ZERO real requests, proven against
 * a live server). So a workspace turning this setting on does NOT, on its
 * own, exfiltrate anything on a fresh clone with no prior grant — the net
 * capability gate holds regardless of who flipped the setting. What a
 * workspace-scope `markii.runOnOpen` DOES change is quieter but still real:
 * it makes Lua execution happen on file open with literally no user
 * gesture at all, for a repo the user did not personally configure that
 * way, which is the exact category of "the workspace decided for me,
 * silently" that `markii.packs`'s `application` scope was written to
 * foreclose for packs. It also multiplies the DNS-rebinding and
 * hostname-reuse edge cases docs/security.md already documents as
 * accepted-risk (a granted hostname's later DNS change; a same-hostname,
 * different-port grant) onto every open of a workspace someone else
 * configured, not just ones the current user chose for themselves.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGE_JSON_PATH = resolve(import.meta.dirname, '../package.json');

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} is not an object`);
  }
  return value as Record<string, unknown>;
}

const packageJson: unknown = JSON.parse(
  readFileSync(PACKAGE_JSON_PATH, 'utf8'),
);
const contributes = asRecord(
  asRecord(packageJson, 'package.json').contributes,
  'package.json.contributes',
);

function property(name: string): Record<string, unknown> {
  const configuration = asRecord(
    contributes.configuration,
    'contributes.configuration',
  );
  const properties = asRecord(
    configuration.properties,
    'contributes.configuration.properties',
  );
  return asRecord(properties[name], `properties[${JSON.stringify(name)}]`);
}

describe('issue #12 / item 5: markii.runOnOpen and markii.refreshIntervalSeconds configuration scope', () => {
  it('BASELINE (must stay green): markii.packs is still pinned to application scope, the model this pass compares against', () => {
    expect(property('markii.packs').scope).toBe('application');
  });

  it('markii.runOnOpen is pinned to application scope, so a workspace cannot start running scripts on the reader behalf', () => {
    expect(Object.hasOwn(property('markii.runOnOpen'), 'scope')).toBe(true);
    expect(property('markii.runOnOpen').scope).toBe('application');
  });

  it('markii.refreshIntervalSeconds is pinned to application scope, so a workspace cannot start a refresh timer on the reader behalf', () => {
    expect(
      Object.hasOwn(property('markii.refreshIntervalSeconds'), 'scope'),
    ).toBe(true);
    expect(property('markii.refreshIntervalSeconds').scope).toBe('application');
  });

  it('every setting that can cause code to run unattended is application-scoped, so a new one cannot be added without this decision being made', () => {
    for (const name of [
      'markii.packs',
      'markii.runOnOpen',
      'markii.refreshIntervalSeconds',
    ]) {
      expect(property(name).scope).toBe('application');
    }
  });
});
