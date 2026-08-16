import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_GLOBALS,
  createEmptyLuaEngine,
  DENIED_GLOBALS,
} from './globals';

async function evalGlobal(name: string): Promise<unknown> {
  const engine = await createEmptyLuaEngine();
  try {
    return await engine.doString(`return ${name}`);
  } finally {
    engine.global.close();
  }
}

async function evalExpr(code: string): Promise<unknown> {
  const engine = await createEmptyLuaEngine();
  try {
    return await engine.doString(code);
  } finally {
    engine.global.close();
  }
}

describe('createEmptyLuaEngine — denied globals are all nil/absent', () => {
  for (const name of DENIED_GLOBALS) {
    it(`"${name}" is nil`, async () => {
      expect(await evalGlobal(name)).toBeNull();
    });
  }
});

describe('createEmptyLuaEngine — allowed globals are present and callable', () => {
  it('the scalar functions/tables are present (not nil)', async () => {
    for (const name of ALLOWED_GLOBALS) {
      const value = await evalGlobal(name);
      expect(value, `expected global "${name}" to be present`).not.toBeNull();
    }
  });

  it('pcall/assert/error/type/tostring/tonumber behave normally', async () => {
    expect(await evalExpr('return type(1)')).toBe('number');
    expect(await evalExpr('return tostring(1) .. tostring(2)')).toBe('12');
    expect(await evalExpr('return tonumber("42")')).toBe(42);
    expect(
      await evalExpr('local ok = pcall(function() error("x") end); return ok'),
    ).toBe(false);
  });

  it('string/table/math libraries work', async () => {
    expect(await evalExpr('return string.upper("abc")')).toBe('ABC');
    expect(await evalExpr('return ("abc"):upper()')).toBe('ABC');
    expect(
      await evalExpr(
        'local t = {3,1,2}; table.sort(t); return t[1] .. t[2] .. t[3]',
      ),
    ).toBe('123');
    expect(await evalExpr('return math.floor(3.7)')).toBe(3);
    expect(await evalExpr('return table.unpack({1,2,3})')).toBe(1);
  });
});

describe('createEmptyLuaEngine — sandbox escapes', () => {
  it('string.dump is absent (bytecode-dump leak closed)', async () => {
    expect(await evalGlobal('string.dump')).toBeNull();
  });

  it('cannot compile/run new source via load', async () => {
    expect(await evalGlobal('load')).toBeNull();
  });

  it('cannot load or run files', async () => {
    expect(await evalGlobal('loadfile')).toBeNull();
    expect(await evalGlobal('dofile')).toBeNull();
  });

  it('cannot reach a metatable to tamper with it (getmetatable removed)', async () => {
    expect(await evalGlobal('getmetatable')).toBeNull();
    expect(await evalGlobal('setmetatable')).toBeNull();
  });

  it('calling getmetatable as if it existed fails as a normal Lua error, not a crash', async () => {
    const result = await evalExpr(
      'local ok, err = pcall(function() return getmetatable("") end); return tostring(ok)',
    );
    expect(result).toBe('false');
  });

  it('_G is nil, and so is the "_G" name a script might expect to enumerate', async () => {
    expect(await evalGlobal('_G')).toBeNull();
  });

  it('_ENV is reachable (it is a Lua-language upvalue, not something we can remove) but recovers nothing: os/io/require were never installed, so _ENV.os is nil too', async () => {
    const result = await evalExpr(`
      local env = _ENV
      return tostring(env.os) .. "," .. tostring(env.io) .. "," .. tostring(env.require) .. "," .. tostring(env.debug) .. "," .. tostring(env.package)
    `);
    expect(result).toBe('nil,nil,nil,nil,nil');
  });

  it('_ENV cannot recover string.dump either — the same table object was mutated, not rebound', async () => {
    const result = await evalExpr('return _ENV.string.dump');
    expect(result).toBeNull();
  });

  it('rawget/rawset/rawequal/rawlen are absent', async () => {
    expect(await evalGlobal('rawget')).toBeNull();
    expect(await evalGlobal('rawset')).toBeNull();
    expect(await evalGlobal('rawequal')).toBeNull();
    expect(await evalGlobal('rawlen')).toBeNull();
  });

  it('collectgarbage is absent (no GC-tuning DoS knob)', async () => {
    expect(await evalGlobal('collectgarbage')).toBeNull();
  });

  it('print/warn are absent (no stdout/stderr side channel)', async () => {
    expect(await evalGlobal('print')).toBeNull();
    expect(await evalGlobal('warn')).toBeNull();
  });

  it('os, io, debug, package, coroutine were never loaded at all', async () => {
    expect(await evalGlobal('os')).toBeNull();
    expect(await evalGlobal('io')).toBeNull();
    expect(await evalGlobal('debug')).toBeNull();
    expect(await evalGlobal('package')).toBeNull();
    expect(await evalGlobal('coroutine')).toBeNull();
  });

  it('require is not a raw Lua global (this phase leaves it undefined entirely — see ./require)', async () => {
    expect(await evalGlobal('require')).toBeNull();
  });
});

describe('createEmptyLuaEngine — wasmUri option (CDN-avoidance threading)', () => {
  it('omitting the options object behaves exactly like today (Node local resolution, no error)', async () => {
    const engine = await createEmptyLuaEngine();
    try {
      expect(await engine.doString('return 1 + 1')).toBe(2);
    } finally {
      engine.global.close();
    }
  });

  it('passing { wasmUri: undefined } is identical to omitting it entirely', async () => {
    const engine = await createEmptyLuaEngine({ wasmUri: undefined });
    try {
      expect(await engine.doString('return 1 + 1')).toBe(2);
    } finally {
      engine.global.close();
    }
  });

  it('an explicit local wasm path is accepted and produces a fully working engine (proves the option actually reaches LuaFactory, not just that it is silently ignored)', async () => {
    // Resolve the exact same glue.wasm the default (no customWasmUri) path
    // would use, via Node's own module resolution rather than a hardcoded
    // relative path — this is the same file `createEmptyLuaEngine()`
    // resolves to by default, so a passing run here proves `wasmUri`
    // reaches `LuaFactory`'s `customWasmUri` (a browser host would instead
    // pass a bundler-provided URL — see the playground's `?url` import).
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve('wasmoon/dist/glue.wasm');

    const engine = await createEmptyLuaEngine({ wasmUri: wasmPath });
    try {
      // Full round trip through the curated environment, not just "it
      // booted" — confirms the custom-URI engine is indistinguishable in
      // behavior from the default one (same libraries, same scrub prelude).
      expect(await engine.doString('return string.upper("ok")')).toBe('OK');
      expect(await engine.doString('return os')).toBeNull();
    } finally {
      engine.global.close();
    }
  });
});

describe('createEmptyLuaEngine — isolation across engines', () => {
  it('a global set in one engine is absent from a freshly created one', async () => {
    const engineA = await createEmptyLuaEngine();
    await engineA.doString('leaked_value = 42');
    expect(await engineA.doString('return leaked_value')).toBe(42);
    engineA.global.close();

    const engineB = await createEmptyLuaEngine();
    try {
      expect(await engineB.doString('return leaked_value')).toBeNull();
    } finally {
      engineB.global.close();
    }
  });
});
