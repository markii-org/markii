import { describe, expect, it } from 'vitest';
import { createLuaExecutor } from './executor';
import { runScript } from './sandbox';
import { netProviderDenial, netTransportFailure } from './capabilities';

/**
 * Executed probes against the real wasmoon VM. A run is a `network` failure
 * only when it ends with the very transport failure the provider raised.
 * The message text never decides it.
 */
const MESSAGE = 'request failed: connect ECONNREFUSED 127.0.0.1:9';
const grants = { get: ['api.example.com'], post: [] };
const URL_ = 'https://api.example.com/x';

const transportProvider = {
  get: async () => {
    throw netTransportFailure(new TypeError(MESSAGE));
  },
};

describe('network failure kind, real wasmoon', () => {
  it('a transport failure that ends the script is network', async () => {
    const r = await runScript({
      code: `return net.fetch_json("${URL_}")`,
      tier: 'manual',
      net: transportProvider,
      netGrants: grants,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('network');
  });

  it('maps to the shared network kind through the executor', async () => {
    const run = createLuaExecutor({
      net: transportProvider,
      netGrants: grants,
    });
    const r = await run({
      code: `return net.fetch_json("${URL_}")`,
      tier: 'manual',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('network');
  });

  it('an unmarked provider failure stays a runtime error', async () => {
    const r = await runScript({
      code: `return net.fetch_json("${URL_}")`,
      tier: 'manual',
      net: {
        get: async () => {
          throw new TypeError(MESSAGE);
        },
      },
      netGrants: grants,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('runtime');
  });

  it('error() with the text of a real transport failure is a runtime error', async () => {
    const r = await runScript({
      code: `error(${JSON.stringify(MESSAGE)})`,
      tier: 'manual',
      net: transportProvider,
      netGrants: grants,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('runtime');
  });

  it('a script that catches the failure and then errors itself is a runtime error', async () => {
    const r = await runScript({
      code: `local ok, e = pcall(net.fetch_json, "${URL_}")
error("my own bug")`,
      tier: 'manual',
      net: transportProvider,
      netGrants: grants,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('runtime');
  });

  it('a script that rebuilds the failure text into a string is a runtime error', async () => {
    const r = await runScript({
      code: `local ok, e = pcall(net.fetch_json, "${URL_}")
error(tostring(e))`,
      tier: 'manual',
      net: transportProvider,
      netGrants: grants,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('runtime');
  });

  it('a script that re-raises the caught failure itself ends with that failure', async () => {
    const r = await runScript({
      code: `local ok, e = pcall(net.fetch_json, "${URL_}")
error(e)`,
      tier: 'manual',
      net: transportProvider,
      netGrants: grants,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('network');
  });

  it('a provider policy refusal stays a capability denial', async () => {
    const r = await runScript({
      code: `return net.fetch_json("${URL_}")`,
      tier: 'manual',
      net: {
        get: async () => {
          throw netProviderDenial('address refused');
        },
      },
      netGrants: grants,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('capability');
      expect(r.error.capability).toBe('denied');
    }
  });

  it('an ungranted host stays a capability denial', async () => {
    const r = await runScript({
      code: `return net.fetch_json("https://other.example.com/x")`,
      tier: 'manual',
      net: transportProvider,
      netGrants: grants,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('capability');
  });
});
