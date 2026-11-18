import { describe, expect, it } from 'vitest';
import { createLuaExecutor } from './executor';
import { runScript } from './sandbox';

/**
 * Executed probes against the real wasmoon VM. `net.fetch_json` raises an
 * ordinary script error for a status outside 200..299. `net.get` returns
 * the status and the undecoded body and never raises on status.
 * Redirect statuses (300..399) are resolved by the provider before a
 * response reaches the sandbox, so the sandbox only guards the range.
 */
const URL_ = 'https://api.example.com/x';
const grants = { get: ['api.example.com'], post: [] };

const reply = (status: number, body: string) => ({
  get: async () => ({ status, body }),
});

const run = (code: string, status: number, body: string) =>
  runScript({
    code,
    tier: 'manual',
    net: reply(status, body),
    netGrants: grants,
  });

describe('net.fetch_json status, real wasmoon', () => {
  it.each([200, 299])('status %i decodes the body', async (status) => {
    const r = await run(
      `return net.fetch_json("${URL_}").a`,
      status,
      '{"a":1}',
    );
    expect(r).toEqual({ ok: true, value: 1 });
  });

  it.each([199, 300, 399, 403, 404, 500])(
    'status %i raises with the status in the message',
    async (status) => {
      const r = await run(
        `return net.fetch_json("${URL_}")`,
        status,
        '{"a":1}',
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe('runtime');
        expect(r.error.capability).toBeUndefined();
        expect(r.error.message).toContain(
          `GET ${URL_} answered ${String(status)}`,
        );
      }
    },
  );

  it('a 403 with a JSON body raises instead of returning the body', async () => {
    const r = await run(
      `return net.fetch_json("${URL_}")`,
      403,
      '{"message":"API rate limit exceeded"}',
    );
    expect(r.ok).toBe(false);
  });

  it('a 404 with an HTML body reports the status, not invalid JSON', async () => {
    const r = await run(
      `return net.fetch_json("${URL_}")`,
      404,
      '<html>Not found</html>',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain('answered 404');
      expect(r.error.message).not.toContain('valid JSON');
    }
  });

  it('pcall catches the error and reads the exact message', async () => {
    const r = await run(
      `local ok, err = pcall(net.fetch_json, "${URL_}")
       return tostring(ok) .. "|" .. tostring(err)`,
      403,
      '{}',
    );
    expect(r).toEqual({ ok: true, value: `false|GET ${URL_} answered 403` });
  });

  it('the byte cap still runs before the status check', async () => {
    const r = await runScript({
      code: `return net.fetch_json("${URL_}")`,
      tier: 'manual',
      net: reply(500, 'x'.repeat(100)),
      netGrants: grants,
      maxFetchBytes: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('capability');
  });

  it('classifies as script-error through the executor, with no capability record', async () => {
    const exec = createLuaExecutor({
      net: reply(404, 'gone'),
      netGrants: grants,
    });
    const r = await exec({
      code: `return net.fetch_json("${URL_}")`,
      tier: 'manual',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('script-error');
  });

  it('rebinding error, tostring or the raw handle cannot turn a 403 into data', async () => {
    const r = await run(
      `error = function() end
       tostring = function() return "x" end
       __smd_net_get = function() return 200, "{}" end
       __smd_net_get_raw = function() return 200, "{}" end
       return net.fetch_json("${URL_}")`,
      403,
      '{}',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('answered 403');
  });
});

describe('net.get, real wasmoon', () => {
  it.each([
    [200, '{"a":1}'],
    [204, ''],
    [299, 'ok'],
    [302, ''],
    [403, '{"message":"limited"}'],
    [404, '<html>x</html>'],
  ])('status %i returns status and raw body', async (status, body) => {
    const r = await run(
      `local r = net.get("${URL_}")
       return { status = r.status, body = r.body, t = type(r) }`,
      status,
      body,
    );
    expect(r).toEqual({ ok: true, value: { status, body, t: 'table' } });
  });

  it('is allowed under the auto tier', async () => {
    const r = await runScript({
      code: `return net.get("${URL_}").status`,
      tier: 'auto',
      net: reply(200, '{}'),
      netGrants: grants,
    });
    expect(r).toEqual({ ok: true, value: 200 });
  });

  it('a denied call is a recorded denial, not a nil call', async () => {
    const r = await runScript({
      code: `return net.get("${URL_}")`,
      tier: 'manual',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('capability');
      expect(r.error.capability).toBe('denied');
    }
  });

  it('an ungranted host is a denial even with a provider', async () => {
    const r = await run(
      `return net.get("https://evil.example.com/x")`,
      200,
      '{}',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('capability');
  });

  it('the byte cap applies', async () => {
    const r = await runScript({
      code: `return net.get("${URL_}")`,
      tier: 'manual',
      net: reply(200, 'x'.repeat(100)),
      netGrants: grants,
      maxFetchBytes: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('capability');
  });

  it('rebinding globals cannot change what net.get returns', async () => {
    const r = await run(
      `__smd_net_get_status = function() return 200, "forged" end
       __smd_net_get_status_raw = function() return 200, "forged" end
       __smd_net_get = function() return 200, "forged" end
       local r = net.get("${URL_}")
       return r.status`,
      403,
      'real',
    );
    expect(r).toEqual({ ok: true, value: 403 });
  });

  it('leaves no private name behind', async () => {
    const r = await run(
      `local found = {}
       for name in pairs(_ENV) do
         if string.sub(name, 1, 6) == "__smd_" and name ~= "__smd_marshal_root" then found[#found + 1] = name end
       end
       return #found`,
      200,
      '{}',
    );
    expect(r).toEqual({ ok: true, value: 0 });
  });
});
