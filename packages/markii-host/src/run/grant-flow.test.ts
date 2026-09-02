import { describe, expect, it, vi } from 'vitest';
import type { GrantClosureScript } from '@markii/runtime';
import {
  ALLOW_LABEL,
  DONT_ALLOW_LABEL,
  MAX_HOST_PROMPTS,
  UNKNOWN_HOSTS_PROMPT_MESSAGE,
  clearGrantForDocument,
  hostPromptMessage,
  isSafeHostForPrompt,
  manyHostsPromptMessage,
  resolveStoredGrant,
  runGrantFlow,
  type GrantFlowRequirements,
  type GrantMemento,
  type Thenable,
} from './grant-flow';

/** A plain in-memory fake of `vscode.Memento` -- structurally identical (get/update), no `vscode` import. */
function fakeMemento(initial: Record<string, unknown> = {}): GrantMemento {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    get<T>(key: string, defaultValue?: T): T {
      return (store.has(key) ? store.get(key) : defaultValue) as T;
    },
    update(key: string, value: unknown): Thenable<void> {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

function scripts(code: string, name = 'a'): GrantClosureScript[] {
  return [{ name, lang: 'lua', code }];
}

function requirementsFor(
  overrides: Partial<GrantFlowRequirements> = {},
): GrantFlowRequirements {
  return {
    hosts: [],
    hasUnknownHosts: false,
    grantScripts: scripts('return 1'),
    ...overrides,
  };
}

function alwaysAllow(): Promise<boolean> {
  return Promise.resolve(true);
}

function alwaysDeny(): Promise<boolean> {
  return Promise.resolve(false);
}

describe('runGrantFlow — first run (no stored grant)', () => {
  it('prompts once per host and grants only the accepted ones', async () => {
    const memento = fakeMemento();
    const prompted: string[] = [];
    const promptHost = vi.fn((host: string) => {
      prompted.push(host);
      return Promise.resolve(host === 'api.example.com');
    });

    const result = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements: requirementsFor({
        hosts: ['api.example.com', 'evil.example.com'],
      }),
      memento,
      promptHost,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });

    expect(prompted).toEqual(['api.example.com', 'evil.example.com']);
    expect(result.allowedHosts).toEqual(['api.example.com']);
  });

  it('never prompts at all when there are no hosts and no unknown hosts', async () => {
    const memento = fakeMemento();
    const promptHost = vi.fn(alwaysAllow);
    const promptUnknownHosts = vi.fn(alwaysAllow);

    const result = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements: requirementsFor(),
      memento,
      promptHost,
      promptUnknownHosts,
      promptManyHosts: alwaysAllow,
    });

    expect(promptHost).not.toHaveBeenCalled();
    expect(promptUnknownHosts).not.toHaveBeenCalled();
    expect(result.allowedHosts).toEqual([]);
  });

  it('adds the extra unknown-hosts prompt when hasUnknownHosts is set, without granting a host for it', async () => {
    const memento = fakeMemento();
    const promptUnknownHosts = vi.fn(alwaysAllow);

    const result = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements: requirementsFor({
        hosts: ['api.example.com'],
        hasUnknownHosts: true,
      }),
      memento,
      promptHost: alwaysAllow,
      promptUnknownHosts,
      promptManyHosts: alwaysAllow,
    });

    expect(promptUnknownHosts).toHaveBeenCalledTimes(1);
    expect(result.allowedHosts).toEqual(['api.example.com']);
  });

  it('declining the unknown-hosts prompt withdraws every already-accepted host', async () => {
    const memento = fakeMemento();

    const result = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements: requirementsFor({
        hosts: ['api.example.com'],
        hasUnknownHosts: true,
      }),
      memento,
      promptHost: alwaysAllow,
      promptUnknownHosts: alwaysDeny,
      promptManyHosts: alwaysAllow,
    });

    expect(result.allowedHosts).toEqual([]);
  });

  it('declining a specific host prompt stores nothing for that host but keeps others', async () => {
    const memento = fakeMemento();
    const promptHost = (host: string) =>
      Promise.resolve(host === 'ok.example.com');

    const result = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements: requirementsFor({
        hosts: ['ok.example.com', 'no.example.com'],
      }),
      memento,
      promptHost,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });

    expect(result.allowedHosts).toEqual(['ok.example.com']);
  });
});

describe('runGrantFlow — nothing grantable (the unanswerable-prompt loop)', () => {
  // Reported from a real note: every `net.*` call site built its URL from a
  // variable, so the static scan resolved ZERO hosts and set
  // `hasUnknownHosts`. The gate then opened a dialog whose Allow button
  // could grant nothing, and because a run ending with an empty allowlist
  // is never persisted (C-3), the identical dialog reopened on every Run
  // press, forever.
  const nothingGrantable = () =>
    requirementsFor({ hosts: [], hasUnknownHosts: true });

  it('does not open a gate that could not change the outcome', async () => {
    const promptUnknownHosts = vi.fn(alwaysAllow);
    const promptHost = vi.fn(alwaysAllow);

    const result = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements: nothingGrantable(),
      memento: fakeMemento(),
      promptHost,
      promptUnknownHosts,
      promptManyHosts: alwaysAllow,
    });

    expect(promptUnknownHosts).not.toHaveBeenCalled();
    expect(promptHost).not.toHaveBeenCalled();
    expect(result.allowedHosts).toEqual([]);
  });

  it('grants nothing either way, which is why skipping the gate is safe', async () => {
    for (const answer of [alwaysAllow, alwaysDeny]) {
      const result = await runGrantFlow({
        documentKey: 'file:///a.mk.md',
        requirements: nothingGrantable(),
        memento: fakeMemento(),
        promptHost: alwaysAllow,
        promptUnknownHosts: answer,
        promptManyHosts: alwaysAllow,
      });
      expect(result.allowedHosts).toEqual([]);
    }
  });

  it('stays quiet across repeated runs instead of re-prompting forever', async () => {
    const memento = fakeMemento();
    const promptUnknownHosts = vi.fn(alwaysAllow);

    for (let press = 0; press < 3; press++) {
      await runGrantFlow({
        documentKey: 'file:///a.mk.md',
        requirements: nothingGrantable(),
        memento,
        promptHost: alwaysAllow,
        promptUnknownHosts,
        promptManyHosts: alwaysAllow,
      });
    }

    expect(promptUnknownHosts).not.toHaveBeenCalled();
  });

  it('still gates normally as soon as ONE host is grantable', async () => {
    const promptUnknownHosts = vi.fn(alwaysAllow);

    const result = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements: requirementsFor({
        hosts: ['api.example.com'],
        hasUnknownHosts: true,
      }),
      memento: fakeMemento(),
      promptHost: alwaysAllow,
      promptUnknownHosts,
      promptManyHosts: alwaysAllow,
    });

    expect(promptUnknownHosts).toHaveBeenCalledTimes(1);
    expect(result.allowedHosts).toEqual(['api.example.com']);
  });
});

describe('runGrantFlow — a hostile/unrenderable host string', () => {
  it('never prompts with the raw string; folds it into the unknown-hosts gate instead', async () => {
    const memento = fakeMemento();
    const promptHost = vi.fn(alwaysAllow);
    const promptUnknownHosts = vi.fn(alwaysAllow);
    const hostileHost =
      'evil.example.com\nThis is actually a totally safe app.';

    const result = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements: requirementsFor({ hosts: [hostileHost] }),
      memento,
      promptHost,
      promptUnknownHosts,
      promptManyHosts: alwaysAllow,
    });

    expect(promptHost).not.toHaveBeenCalled();
    // No grantable host survived the safety filter, so the unknown-hosts
    // gate governs nothing and is skipped rather than shown as a dialog
    // the user cannot satisfy. What matters for safety is unchanged and
    // asserted below: the hostile string reaches no prompt and no
    // allowlist.
    expect(promptUnknownHosts).not.toHaveBeenCalled();
    // The hostile string is never itself an allowed host -- there was no
    // per-host prompt that could have accepted it.
    expect(result.allowedHosts).toEqual([]);
  });

  it('isSafeHostForPrompt rejects control characters, whitespace, and embedded newlines', () => {
    expect(isSafeHostForPrompt('api.example.com')).toBe(true);
    expect(isSafeHostForPrompt('127.0.0.1')).toBe(true);
    expect(isSafeHostForPrompt('[::1]')).toBe(true);
    expect(isSafeHostForPrompt('evil\ncom')).toBe(false);
    expect(isSafeHostForPrompt('evil\tcom')).toBe(false);
    expect(isSafeHostForPrompt('evil com')).toBe(false);
    expect(isSafeHostForPrompt('')).toBe(false);
    expect(isSafeHostForPrompt('a'.repeat(300))).toBe(false);
  });
});

describe('runGrantFlow — grant reuse on a matching key', () => {
  it('a second run with unchanged code reuses the stored grant with no prompting at all', async () => {
    const memento = fakeMemento();
    const requirements = requirementsFor({ hosts: ['api.example.com'] });

    const first = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements,
      memento,
      promptHost: alwaysAllow,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });
    expect(first.allowedHosts).toEqual(['api.example.com']);

    const promptHost = vi.fn(alwaysAllow);
    const promptUnknownHosts = vi.fn(alwaysAllow);
    const second = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements,
      memento,
      promptHost,
      promptUnknownHosts,
      promptManyHosts: alwaysAllow,
    });

    expect(promptHost).not.toHaveBeenCalled();
    expect(promptUnknownHosts).not.toHaveBeenCalled();
    expect(second.allowedHosts).toEqual(['api.example.com']);
  });

  it('a code change produces a new key and re-prompts', async () => {
    const memento = fakeMemento();

    const before = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements: requirementsFor({
        hosts: ['api.example.com'],
        grantScripts: scripts('return 1'),
      }),
      memento,
      promptHost: alwaysAllow,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });
    expect(before.allowedHosts).toEqual(['api.example.com']);

    const promptHost = vi.fn(alwaysAllow);
    const after = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements: requirementsFor({
        hosts: ['api.example.com'],
        grantScripts: scripts('return 2'), // the only thing that changed
      }),
      memento,
      promptHost,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });

    expect(promptHost).toHaveBeenCalledTimes(1);
    expect(after.allowedHosts).toEqual(['api.example.com']);
  });

  it("a different document (different documentKey) never reuses another document's grant", async () => {
    const memento = fakeMemento();
    const requirements = requirementsFor({ hosts: ['api.example.com'] });

    await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements,
      memento,
      promptHost: alwaysAllow,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });

    const promptHost = vi.fn(alwaysAllow);
    await runGrantFlow({
      documentKey: 'file:///b.mk.md',
      requirements,
      memento,
      promptHost,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });

    expect(promptHost).toHaveBeenCalledTimes(1);
  });

  it('a corrupt/foreign stored grant shape degrades to a fresh prompt rather than throwing', async () => {
    const memento = fakeMemento({
      'markii.netGrants': { 'file:///a.mk.md': { garbage: true } },
    });
    const promptHost = vi.fn(alwaysAllow);

    const result = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements: requirementsFor({ hosts: ['api.example.com'] }),
      memento,
      promptHost,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });

    expect(promptHost).toHaveBeenCalledTimes(1);
    expect(result.allowedHosts).toEqual(['api.example.com']);
  });

  it('a stored grant with a prototype-inherited (not owned) allowedHosts is not trusted', async () => {
    const proto = { allowedHosts: ['api.example.com'] };
    const hostileGrant = Object.assign(Object.create(proto), {
      key: 'whatever',
    });
    const memento = fakeMemento({
      'markii.netGrants': { 'file:///a.mk.md': hostileGrant },
    });
    const promptHost = vi.fn(alwaysAllow);

    await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements: requirementsFor({ hosts: ['api.example.com'] }),
      memento,
      promptHost,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });

    expect(promptHost).toHaveBeenCalledTimes(1);
  });
});

describe('runGrantFlow — C-3: full decline is never persisted', () => {
  it('declining the only host re-prompts on the very next run (no permanent lockout from one mis-click)', async () => {
    const memento = fakeMemento();
    const requirements = requirementsFor({ hosts: ['api.example.com'] });

    const first = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements,
      memento,
      promptHost: alwaysDeny,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });
    expect(first.allowedHosts).toEqual([]);
    // Nothing was ever written -- a full decline never even calls
    // `memento.update`, so the key stays entirely absent.
    expect(memento.get('markii.netGrants')).toBeUndefined();

    const promptHost = vi.fn(alwaysAllow);
    const second = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements,
      memento,
      promptHost,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });

    expect(promptHost).toHaveBeenCalledTimes(1);
    expect(second.allowedHosts).toEqual(['api.example.com']);
  });

  it('declining the unknown-hosts gate is also never persisted, and re-prompts next time', async () => {
    const memento = fakeMemento();
    const requirements = requirementsFor({
      hosts: ['api.example.com'],
      hasUnknownHosts: true,
    });

    await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements,
      memento,
      promptHost: alwaysAllow,
      promptUnknownHosts: alwaysDeny,
      promptManyHosts: alwaysAllow,
    });
    expect(memento.get('markii.netGrants')).toBeUndefined();

    const promptHost = vi.fn(alwaysAllow);
    const promptUnknownHosts = vi.fn(alwaysAllow);
    await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements,
      memento,
      promptHost,
      promptUnknownHosts,
      promptManyHosts: alwaysAllow,
    });

    expect(promptHost).toHaveBeenCalledTimes(1);
    expect(promptUnknownHosts).toHaveBeenCalledTimes(1);
  });

  it('a partial grant (at least one host allowed) IS persisted and reused with no re-prompt', async () => {
    const memento = fakeMemento();
    const requirements = requirementsFor({
      hosts: ['ok.example.com', 'no.example.com'],
    });
    const promptHost = (host: string) =>
      Promise.resolve(host === 'ok.example.com');

    const first = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements,
      memento,
      promptHost,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });
    expect(first.allowedHosts).toEqual(['ok.example.com']);
    expect(memento.get('markii.netGrants')).not.toEqual({});

    const secondPromptHost = vi.fn(alwaysAllow);
    const second = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements,
      memento,
      promptHost: secondPromptHost,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });

    expect(secondPromptHost).not.toHaveBeenCalled();
    expect(second.allowedHosts).toEqual(['ok.example.com']);
  });
});

describe('clearGrantForDocument', () => {
  it('removes a stored grant, so the next run prompts fresh', async () => {
    const memento = fakeMemento();
    const requirements = requirementsFor({ hosts: ['api.example.com'] });

    await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements,
      memento,
      promptHost: alwaysAllow,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });
    expect(memento.get('markii.netGrants')).not.toEqual({});

    await clearGrantForDocument(memento, 'file:///a.mk.md');
    expect(memento.get('markii.netGrants')).toEqual({});

    const promptHost = vi.fn(alwaysAllow);
    await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements,
      memento,
      promptHost,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });
    expect(promptHost).toHaveBeenCalledTimes(1);
  });

  it("never touches another document's grant", async () => {
    const memento = fakeMemento();
    const requirements = requirementsFor({ hosts: ['api.example.com'] });

    await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements,
      memento,
      promptHost: alwaysAllow,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });
    await runGrantFlow({
      documentKey: 'file:///b.mk.md',
      requirements,
      memento,
      promptHost: alwaysAllow,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });

    await clearGrantForDocument(memento, 'file:///a.mk.md');

    const promptHostB = vi.fn(alwaysAllow);
    await runGrantFlow({
      documentKey: 'file:///b.mk.md',
      requirements,
      memento,
      promptHost: promptHostB,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });
    expect(promptHostB).not.toHaveBeenCalled();
  });

  it('is a no-op (never throws) when nothing is stored for the document', async () => {
    const memento = fakeMemento();
    await expect(
      clearGrantForDocument(memento, 'file:///never-run.mk.md'),
    ).resolves.toBeUndefined();
  });
});

describe('prompt wording', () => {
  it('matches the locked design comment exactly', () => {
    expect(hostPromptMessage('api.example.com')).toBe(
      "This note's scripts can send data to api.example.com. Allow?",
    );
    expect(UNKNOWN_HOSTS_PROMPT_MESSAGE).toBe(
      "This note builds network addresses at run time, which can't be listed in advance and will be denied; only the hosts written directly in the note can be granted. Allow those?",
    );
    expect(ALLOW_LABEL).toBe('Allow');
    expect(DONT_ALLOW_LABEL).toBe("Don't allow");
  });

  it('the many-hosts message names the exact count', () => {
    expect(manyHostsPromptMessage(42)).toBe(
      'This note requests network access to many hosts (42). Allow all or deny all?',
    );
  });
});

describe('runGrantFlow — F-1: bundleModules participates in the grant key', () => {
  function srcScripts(
    name = 'a',
    src = 'scripts/etl.lua',
  ): GrantClosureScript[] {
    return [{ name, lang: 'lua', src, code: '' }];
  }

  it('changing the resolved src= file content (note text unchanged) produces a new key and re-prompts', async () => {
    const memento = fakeMemento();

    const before = await runGrantFlow({
      documentKey: 'file:///bundle.mkz',
      requirements: requirementsFor({
        hosts: ['api.example.com'],
        grantScripts: srcScripts(),
        bundleModules: { 'scripts/etl.lua': 'return 1' },
      }),
      memento,
      promptHost: alwaysAllow,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });
    expect(before.allowedHosts).toEqual(['api.example.com']);

    const promptHost = vi.fn(alwaysAllow);
    const after = await runGrantFlow({
      documentKey: 'file:///bundle.mkz',
      requirements: requirementsFor({
        hosts: ['api.example.com'],
        grantScripts: srcScripts(), // the note's own script block is byte-identical...
        bundleModules: { 'scripts/etl.lua': 'return 2' }, // ...only the referenced file's content changed
      }),
      memento,
      promptHost,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });

    expect(promptHost).toHaveBeenCalledTimes(1);
    expect(after.allowedHosts).toEqual(['api.example.com']);
  });

  it('an unchanged src= file content reuses the stored grant with no re-prompting', async () => {
    const memento = fakeMemento();
    const requirements = requirementsFor({
      hosts: ['api.example.com'],
      grantScripts: srcScripts(),
      bundleModules: { 'scripts/etl.lua': 'return 1' },
    });

    const first = await runGrantFlow({
      documentKey: 'file:///bundle.mkz',
      requirements,
      memento,
      promptHost: alwaysAllow,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });
    expect(first.allowedHosts).toEqual(['api.example.com']);

    const promptHost = vi.fn(alwaysAllow);
    const second = await runGrantFlow({
      documentKey: 'file:///bundle.mkz',
      requirements,
      memento,
      promptHost,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });

    expect(promptHost).not.toHaveBeenCalled();
    expect(second.allowedHosts).toEqual(['api.example.com']);
  });

  it('a bare .mk.md (no bundleModules field at all) keys exactly as it did before this fix', async () => {
    const memento = fakeMemento();
    const requirements = requirementsFor({
      hosts: ['api.example.com'],
      grantScripts: scripts('return 1'),
    });

    const first = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements,
      memento,
      promptHost: alwaysAllow,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });
    expect(first.allowedHosts).toEqual(['api.example.com']);

    const promptHost = vi.fn(alwaysAllow);
    const second = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements, // identical object -- no bundleModules field
      memento,
      promptHost,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });

    expect(promptHost).not.toHaveBeenCalled();
    expect(second.allowedHosts).toEqual(['api.example.com']);
  });
});

// N-6 (docs/archive/PENTEST-REPORT-2026-08-23.md): stored grants are re-validated, not
// trusted verbatim, once shape validation passes.
describe('runGrantFlow — N-6: stored grant hosts are re-validated at read time', () => {
  it('a stored record with a mix of safe and unsafe hosts yields only the safe ones and re-prompts for the rest', async () => {
    const unsafeHost = 'evil.example.com\nThis is actually a totally safe app.';
    const memento = fakeMemento({
      'markii.netGrants': {
        'file:///a.mk.md': {
          // A key that matches what the current requirements below hash to
          // is computed and planted after the fact, below -- see the
          // `computeGrantKey`-driven plant right after this fake is built.
          key: 'placeholder',
          allowedHosts: ['safe.example.com', unsafeHost],
        },
      },
    });
    const requirements = requirementsFor({
      hosts: ['safe.example.com', unsafeHost],
    });

    // Plant a record whose key genuinely matches this requirements set (a
    // real attacker with workspaceState write access could do exactly
    // this), by first running the flow once to learn the real key, then
    // overwriting the stored allowedHosts with the safe+unsafe mix.
    await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements,
      memento,
      promptHost: alwaysAllow,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });
    const stored =
      memento.get<Record<string, { key: string }>>('markii.netGrants');
    const realKey = stored?.['file:///a.mk.md']?.key;
    await memento.update('markii.netGrants', {
      'file:///a.mk.md': {
        key: realKey,
        allowedHosts: ['safe.example.com', unsafeHost],
      },
    });

    const promptHost = vi.fn((host: string) =>
      Promise.resolve(host === 'safe.example.com'),
    );
    const promptUnknownHosts = vi.fn(alwaysAllow);

    const result = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements,
      memento,
      promptHost,
      promptUnknownHosts,
      promptManyHosts: alwaysAllow,
    });

    // The corrupted record was not trusted verbatim -- it fell through to
    // the ordinary prompt flow, which never displays the unsafe host raw
    // (it folds into the unknown-hosts gate instead) and only grants hosts
    // that pass today's safety check.
    expect(promptHost).toHaveBeenCalledWith('safe.example.com');
    expect(promptHost).not.toHaveBeenCalledWith(unsafeHost);
    expect(promptUnknownHosts).toHaveBeenCalledTimes(1);
    expect(result.allowedHosts).toEqual(['safe.example.com']);
  });

  it('a stored record whose hosts are ALL still safe is reused with no prompting, as before', async () => {
    const memento = fakeMemento();
    const requirements = requirementsFor({ hosts: ['api.example.com'] });

    await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements,
      memento,
      promptHost: alwaysAllow,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });

    const promptHost = vi.fn(alwaysAllow);
    const result = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements,
      memento,
      promptHost,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });

    expect(promptHost).not.toHaveBeenCalled();
    expect(result.allowedHosts).toEqual(['api.example.com']);
  });
});

// PROMPT-STORM guard (report section 8, item 6, docs/archive/PENTEST-REPORT-2026-08-23.md).
describe('runGrantFlow — PROMPT-STORM guard: many distinct hosts fold into one consolidated gate', () => {
  function manyHosts(count: number): string[] {
    return Array.from({ length: count }, (_, i) => `host${i}.example.com`);
  }

  it('a note with more than MAX_HOST_PROMPTS hosts triggers exactly ONE consolidated prompt, not N', async () => {
    const memento = fakeMemento();
    const hostCount = MAX_HOST_PROMPTS + 5;
    const promptHost = vi.fn(alwaysAllow);
    const promptManyHosts = vi.fn(alwaysAllow);

    const result = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements: requirementsFor({ hosts: manyHosts(hostCount) }),
      memento,
      promptHost,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts,
    });

    expect(promptHost).not.toHaveBeenCalled();
    expect(promptManyHosts).toHaveBeenCalledTimes(1);
    expect(promptManyHosts).toHaveBeenCalledWith(hostCount);
    expect(result.allowedHosts).toHaveLength(hostCount);
  });

  it('allow-all grants the full set', async () => {
    const memento = fakeMemento();
    const hostCount = MAX_HOST_PROMPTS + 1;
    const hosts = manyHosts(hostCount);

    const result = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements: requirementsFor({ hosts }),
      memento,
      promptHost: alwaysAllow,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });

    expect(result.allowedHosts).toEqual(hosts);
  });

  it('deny grants none', async () => {
    const memento = fakeMemento();
    const hostCount = MAX_HOST_PROMPTS + 1;

    const result = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements: requirementsFor({ hosts: manyHosts(hostCount) }),
      memento,
      promptHost: alwaysAllow,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysDeny,
    });

    expect(result.allowedHosts).toEqual([]);
  });

  it('a note with exactly MAX_HOST_PROMPTS hosts still gets the per-host flow', async () => {
    const memento = fakeMemento();
    const promptHost = vi.fn(alwaysAllow);
    const promptManyHosts = vi.fn(alwaysAllow);

    const result = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements: requirementsFor({ hosts: manyHosts(MAX_HOST_PROMPTS) }),
      memento,
      promptHost,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts,
    });

    expect(promptHost).toHaveBeenCalledTimes(MAX_HOST_PROMPTS);
    expect(promptManyHosts).not.toHaveBeenCalled();
    expect(result.allowedHosts).toHaveLength(MAX_HOST_PROMPTS);
  });

  it('a note with a small number of hosts still gets the per-host flow', async () => {
    const memento = fakeMemento();
    const promptHost = vi.fn((host: string) =>
      Promise.resolve(host === 'ok.example.com'),
    );
    const promptManyHosts = vi.fn(alwaysAllow);

    const result = await runGrantFlow({
      documentKey: 'file:///a.mk.md',
      requirements: requirementsFor({
        hosts: ['ok.example.com', 'no.example.com'],
      }),
      memento,
      promptHost,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts,
    });

    expect(promptManyHosts).not.toHaveBeenCalled();
    expect(result.allowedHosts).toEqual(['ok.example.com']);
  });
});

describe('resolveStoredGrant — non-interactive (auto/scheduled), issue #11', () => {
  const documentKey = 'file:///a.mk.md';
  const requirements = requirementsFor({ hosts: ['api.example.com'] });

  /** Persists a real grant for `requirements` by running the interactive flow once, allowing the host. */
  async function seedGrant(memento: GrantMemento): Promise<void> {
    await runGrantFlow({
      documentKey,
      requirements,
      memento,
      promptHost: alwaysAllow,
      promptUnknownHosts: alwaysAllow,
      promptManyHosts: alwaysAllow,
    });
  }

  it('reuses a stored grant for the same closure, with no prompting', async () => {
    const memento = fakeMemento();
    await seedGrant(memento);

    const result = await resolveStoredGrant({
      documentKey,
      requirements,
      memento,
    });
    expect(result.allowedHosts).toEqual(['api.example.com']);
  });

  it('returns an empty allowlist when nothing is stored (never prompts, never widens)', async () => {
    const memento = fakeMemento();
    const result = await resolveStoredGrant({
      documentKey,
      requirements,
      memento,
    });
    expect(result.allowedHosts).toEqual([]);
  });

  it('returns empty when the stored grant is for different code (key mismatch)', async () => {
    const memento = fakeMemento();
    await seedGrant(memento);

    const result = await resolveStoredGrant({
      documentKey,
      // Same host, DIFFERENT script code -> different grant key -> miss.
      requirements: requirementsFor({
        hosts: ['api.example.com'],
        grantScripts: scripts('return 2'),
      }),
      memento,
    });
    expect(result.allowedHosts).toEqual([]);
  });

  it('never writes to storage (a miss does not persist an empty grant)', async () => {
    const memento = fakeMemento();
    const update = vi.spyOn(memento, 'update');
    await resolveStoredGrant({ documentKey, requirements, memento });
    expect(update).not.toHaveBeenCalled();
  });

  it('drops a stored grant whose host no longer passes today safety re-check (N-6)', async () => {
    // Plant a record with the correct-looking shape but an unsafe host; even
    // a matching key must not resurrect it non-interactively.
    const memento = fakeMemento();
    await seedGrant(memento);
    const raw = memento.get<
      Record<string, { key: string; allowedHosts: string[] }>
    >('markii.netGrants', {});
    const stored = raw[documentKey];
    if (!stored) throw new Error('expected a seeded grant');
    raw[documentKey] = {
      key: stored.key,
      allowedHosts: ['api.example.com', 'bad host with spaces'],
    };
    await memento.update('markii.netGrants', raw);

    const result = await resolveStoredGrant({
      documentKey,
      requirements,
      memento,
    });
    expect(result.allowedHosts).toEqual([]);
  });
});
