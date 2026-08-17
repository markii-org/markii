import { describe, expect, it } from 'vitest';
import { parse } from './parse.js';
import { extractScripts } from './scripts.js';

function scripts(md: string) {
  return extractScripts(parse(md));
}

function fence(meta: string): string {
  return '```lua ' + meta + '\nreturn 1\n```\n';
}

describe('adversarial: publish is bare-only', () => {
  it('bare publish sets the flag', () => {
    const [b] = scripts(fence('{name=gh publish}'));
    expect(b?.publish).toBe(true);
  });

  it.each([
    'publish=yes',
    'publish=true',
    'publish=1',
    'publish=false',
    'publish=""',
    "publish=''",
  ])('valued form %s does NOT publish (fail closed)', (form) => {
    const [b] = scripts(fence(`{name=gh ${form}}`));
    expect(b).toBeDefined();
    expect(Object.hasOwn(b as object, 'publish')).toBe(false);
  });

  it('a non-publishing block carries no publish key at all', () => {
    const [b] = scripts(fence('{name=gh}'));
    expect(Object.hasOwn(b as object, 'publish')).toBe(false);
  });

  it('the word publish inside a quoted value is not an attribute', () => {
    const [b] = scripts(fence('{name=gh title="a publish b"}'));
    expect(Object.hasOwn(b as object, 'publish')).toBe(false);
  });
});

describe('adversarial: publish only on things that are scripts at all', () => {
  it('publish with no name is not a script', () => {
    expect(scripts(fence('{publish}'))).toHaveLength(0);
  });

  it.each(['a.b', 'gh.stars', '1bad', '-bad', '"has space"', '"a b"'])(
    'publish with the invalid name %s is not a script',
    (name) => {
      expect(scripts(fence(`{name=${name} publish}`))).toHaveLength(0);
    },
  );

  it('an unquoted name with a space takes only the first token (pre-existing grammar)', () => {
    // Documents, rather than asserts as desirable, the whitespace-separated
    // token grammar: `name=has space` yields name `has` plus a separate bare
    // key `space`. Unchanged by this phase.
    const [b] = scripts(fence('{name=has space publish}'));
    expect(b?.name).toBe('has');
    expect(b?.publish).toBe(true);
  });

  it('a name that is a prototype member is a VALID script name and may publish', () => {
    // `__proto__`/`constructor` match the §8 charset, so they are legal
    // script names; the vault must therefore survive them (covered in the
    // runtime probe). This asserts the parser does not special-case them.
    const [b] = scripts(fence('{name=__proto__ publish}'));
    expect(b?.name).toBe('__proto__');
    expect(b?.publish).toBe(true);
  });

  it('publish rides along with src= references', () => {
    const [b] = scripts('```lua {src=scripts/etl.lua name=gh publish}\n```\n');
    expect(b?.src).toBe('scripts/etl.lua');
    expect(b?.publish).toBe(true);
  });
});
