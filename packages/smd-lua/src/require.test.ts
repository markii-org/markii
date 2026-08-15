import { describe, expect, it } from 'vitest';
import { createEmptyLuaEngine } from './globals';
import { buildRequireStub, NOT_YET_SUPPORTED_MESSAGE } from './require';

describe('require — not wired into the sandbox by default (see ./sandbox, ./globals)', () => {
  it('a fresh sandbox engine never defines `require` at all', async () => {
    const engine = await createEmptyLuaEngine();
    try {
      expect(await engine.doString('return type(require)')).toBe('nil');
    } finally {
      engine.global.close();
    }
  });
});

describe('buildRequireStub — opt-in friendlier stub, not wired anywhere by default', () => {
  it('raises a clear "not yet supported" error naming the requested module, never touches load/io/network', async () => {
    const engine = await createEmptyLuaEngine();
    try {
      await engine.doString(buildRequireStub());
      const result = await engine.doString(`
        local ok, err = pcall(require, "scripts/util")
        return tostring(ok) .. ":" .. tostring(err)
      `);
      expect(result).toContain('false:');
      expect(result).toContain('scripts/util');
      expect(result.toLowerCase()).toContain('not yet supported');
    } finally {
      engine.global.close();
    }
  });

  it('NOT_YET_SUPPORTED_MESSAGE is a format string naming the module', () => {
    expect(NOT_YET_SUPPORTED_MESSAGE).toContain('%s');
  });
});
