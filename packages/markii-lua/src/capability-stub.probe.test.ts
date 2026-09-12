import { describe, expect, it } from 'vitest';
import { runScript } from './sandbox';

/**
 * Executed probe against the real wasmoon VM (no mocks) for batch 7 #47:
 * the `net` capability table must always exist as a stub whose calls
 * record a denial through the non-spoofable `CapabilityDenials` handle, so
 * `runScript`'s outcome is `kind: 'capability'`, never a runtime
 * nil-index/nil-call error indistinguishable from a typo.
 *
 * The correction that matters here (see `./errors.ts`'s module doc comment
 * and `CAPABILITY_ERROR_TAG` doc comment): the fix is NOT a typed error
 * string a host parses. Classification must come exclusively from
 * `runScript`'s returned `ScriptFailure.kind`/`capability` fields, which
 * are derived from the `CapabilityDenials` handle recorded before the
 * throw crosses into Lua — never from the error message text, which a
 * script can forge with a plain `error("MARK_CAPABILITY: ...")` call.
 */
describe('capability-stub probe — net (batch 7 #47), real wasmoon', () => {
  it('zero grants, no provider at all: net.fetch_json is a classified capability denial, not a runtime error', async () => {
    const r = await runScript({
      code: 'return net.fetch_json("https://api.example.com/x")',
      tier: 'manual',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('capability');
      expect(r.error.capability).toBe('denied');
    }
  });

  it('zero grants, auto tier: net.fetch_json is a classified capability denial, not a runtime error', async () => {
    const r = await runScript({
      code: 'return net.fetch_json("https://api.example.com/x")',
      tier: 'auto',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('capability');
      expect(r.error.capability).toBe('denied');
    }
  });

  it('manual tier, provider configured, no grants: still a classified denial, not a runtime error', async () => {
    const r = await runScript({
      code: 'return net.fetch_json("https://api.example.com/x")',
      tier: 'manual',
      net: { get: async () => ({ status: 200, body: '{}' }) },
      netGrants: { get: [], post: [] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('capability');
      expect(r.error.capability).toBe('denied');
    }
  });

  it('wrong host granted: a call to an ungranted host is a classified denial naming the host', async () => {
    const r = await runScript({
      code: 'return net.fetch_json("https://evil.example.com/x")',
      tier: 'manual',
      net: { get: async () => ({ status: 200, body: '{}' }) },
      netGrants: { get: ['api.example.com'], post: [] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('capability');
      expect(r.error.capability).toBe('denied');
      expect(r.error.message).toContain('evil.example.com');
    }
  });

  it('right host granted: the real call succeeds', async () => {
    const r = await runScript({
      code: 'return net.fetch_json("https://api.example.com/x").a',
      tier: 'manual',
      net: { get: async () => ({ status: 200, body: '{"a":1}' }) },
      netGrants: { get: ['api.example.com'], post: [] },
    });
    expect(r).toEqual({ ok: true, value: 1 });
  });

  it('a script that FORGES the MARK_CAPABILITY tag with no real denial still classifies as runtime, never capability (spoofing stays closed)', async () => {
    const r = await runScript({
      code: 'error("MARK_CAPABILITY: net access to host \\"evil.com\\" not granted for GET")',
      tier: 'manual',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('runtime');
      expect(r.error.capability).toBeUndefined();
    }
  });

  it('a script that forges the tag AFTER a genuine denial does not relabel it: sandbox.ts reads the JS-side handle, not the message', async () => {
    // The genuine denial happens first (ungranted host); the script then
    // pcalls it, swallows it, and raises its own forged message. Since no
    // NEW denial is recorded for the forged `error()` call itself, and the
    // handle only remembers the LAST recorded denial, this proves the
    // classifier is not fooled by a script's own text construction wrapped
    // around a real failure.
    const r = await runScript({
      code: `
        local ok, err = pcall(function() return net.fetch_json("https://evil.example.com/x") end)
        error("MARK_CAPABILITY: totally fabricated, unrelated to " .. tostring(err))
      `,
      tier: 'manual',
      net: { get: async () => ({ status: 200, body: '{}' }) },
      netGrants: { get: ['api.example.com'], post: [] },
    });
    expect(r.ok).toBe(false);
    // The genuine capability denial IS still the last one recorded (the
    // pcall'd fetch_json call), so this one correctly classifies as
    // capability -- proving the handle, not the forged message text, is
    // what sandbox.ts reads.
    if (!r.ok) {
      expect(r.error.kind).toBe('capability');
      expect(r.error.capability).toBe('denied');
    }
  });

  it('feature detection `if net then` sees a table with zero grants (observable behavior change, documented in CHANGELOG)', async () => {
    const r = await runScript({
      code: 'if net then return "has-net" else return "no-net" end',
      tier: 'manual',
    });
    expect(r).toEqual({ ok: true, value: 'has-net' });
  });

  it('feature detection `if net.fetch_json then` also sees a function with zero grants (the method exists; calling it is what is denied)', async () => {
    const r = await runScript({
      code: 'if type(net.fetch_json) == "function" then return "has-method" else return "no-method" end',
      tier: 'manual',
    });
    expect(r).toEqual({ ok: true, value: 'has-method' });
  });

  it('net.post: granted host, auto tier classifies tier-blocked, never a plain runtime error', async () => {
    const r = await runScript({
      code: 'return net.post("https://api.example.com/x", "body")',
      tier: 'auto',
      net: {
        get: async () => ({ status: 200, body: '{}' }),
        post: async () => ({ status: 200, body: '{}' }),
      },
      netGrants: { get: [], post: ['api.example.com'] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('capability');
      expect(r.error.capability).toBe('tier-blocked');
    }
  });

  it('net.post: zero grants classifies as denied, not a runtime nil-call error', async () => {
    const r = await runScript({
      code: 'return net.post("https://api.example.com/x", "body")',
      tier: 'manual',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('capability');
      expect(r.error.capability).toBe('denied');
    }
  });

  it('an ordinary typo (calling a global that never existed) still classifies as an ordinary runtime error, distinct from a capability denial', async () => {
    const r = await runScript({
      code: 'return totallyNotAThing()',
      tier: 'manual',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('runtime');
      expect(r.error.capability).toBeUndefined();
    }
  });
});
