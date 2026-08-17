import { describe, expect, it } from 'vitest';
import { parse } from './parse';
import { extractScripts, isValidScriptName } from './scripts';

describe('extractScripts', () => {
  it('extracts an inline script block by its `name` attribute', () => {
    const tree = parse(
      [
        '```lua {name=stars}',
        'local repo = net.fetch_json("https://api.github.com/repos/x/y")',
        'return repo.stargazers_count',
        '```',
      ].join('\n'),
    );

    const scripts = extractScripts(tree);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.name).toBe('stars');
    expect(scripts[0]?.lang).toBe('lua');
    expect(scripts[0]?.src).toBeUndefined();
    expect(scripts[0]?.code).toBe(
      'local repo = net.fetch_json("https://api.github.com/repos/x/y")\nreturn repo.stargazers_count',
    );
  });

  it('extracts a `src=` long-script reference with an empty body', () => {
    const tree = parse('```lua {src=scripts/etl.lua name=stars}\n```');

    const scripts = extractScripts(tree);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.name).toBe('stars');
    expect(scripts[0]?.src).toBe('scripts/etl.lua');
    expect(scripts[0]?.code).toBe('');
  });

  it('skips a plain code block with no meta at all', () => {
    const tree = parse('```lua\nprint("hi")\n```');
    expect(extractScripts(tree)).toHaveLength(0);
  });

  it('skips a code block whose meta has attributes but no `name`', () => {
    const tree = parse('```lua {src=scripts/etl.lua}\nprint("hi")\n```');
    expect(extractScripts(tree)).toHaveLength(0);
  });

  it('returns multiple blocks in document order', () => {
    const tree = parse(
      [
        '```lua {name=first}',
        'return 1',
        '```',
        '',
        'Some prose in between.',
        '',
        '```lua {name=second}',
        'return 2',
        '```',
      ].join('\n'),
    );

    const scripts = extractScripts(tree);
    expect(scripts.map((s) => s.name)).toEqual(['first', 'second']);
  });

  it('parses quoted attribute values, including ones containing spaces', () => {
    const tree = parse('```lua {name=stars src="scripts/my etl.lua"}\n```');

    const scripts = extractScripts(tree);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.name).toBe('stars');
    expect(scripts[0]?.src).toBe('scripts/my etl.lua');
  });

  it.each([
    'x',
    '_x',
    'stars',
    'repo_stars',
    'repo-stars',
    'A1',
    '__proto__',
    'constructor',
  ])('extracts a script whose name is %j (charset-valid)', (name) => {
    const tree = parse(`\`\`\`lua {name=${name}}\nreturn 1\n\`\`\``);

    const scripts = extractScripts(tree);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.name).toBe(name);
  });

  it.each([
    'repo.stars', // dots are reserved for data=/:value[] path traversal
    '1stars', // must start with a letter or underscore
    '-stars', // must start with a letter or underscore
    'repo/stars',
    'repo:stars',
    'répo', // non-ASCII letters are outside the charset
    'repo$',
  ])('skips a script whose name is %j (charset-invalid)', (name) => {
    const tree = parse(`\`\`\`lua {name=${name}}\nreturn 1\n\`\`\``);
    expect(extractScripts(tree)).toHaveLength(0);
  });

  it('tokenizes an unquoted `name=repo stars` as name="repo" plus a bare `stars` attribute, not a rejected name', () => {
    // The `{...}` grammar is whitespace-separated tokens (parseMetaAttributes),
    // so an unquoted value can never itself contain a space — `repo stars`
    // splits into `name=repo` and a second, bare `stars` token before the
    // charset gate ever sees a string with a space in it.
    const tree = parse('```lua {name=repo stars}\nreturn 1\n```');

    const scripts = extractScripts(tree);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.name).toBe('repo');
  });

  it('skips a fence with an invalid name even when a valid `src=` is present — name is the gate', () => {
    const tree = parse('```lua {name=repo.stars src=scripts/etl.lua}\n```');
    expect(extractScripts(tree)).toHaveLength(0);
  });

  it('never throws for any charset-invalid name, and always returns an array', () => {
    const invalidNames = [
      'repo.stars',
      '1stars',
      '-stars',
      'repo/stars',
      'repo:stars',
      'répo',
      'repo$',
      '',
    ];
    for (const name of invalidNames) {
      const tree = parse(`\`\`\`lua {name=${name}}\nreturn 1\n\`\`\``);
      expect(() => extractScripts(tree)).not.toThrow();
      expect(Array.isArray(extractScripts(tree))).toBe(true);
    }
  });

  it('returns only the charset-valid blocks, in document order, when one of several is invalid', () => {
    const tree = parse(
      [
        '```lua {name=first}',
        'return 1',
        '```',
        '',
        '```lua {name=repo.stars}',
        'return 2',
        '```',
        '',
        '```lua {name=second}',
        'return 3',
        '```',
      ].join('\n'),
    );

    const scripts = extractScripts(tree);
    expect(scripts.map((s) => s.name)).toEqual(['first', 'second']);
  });
});

describe('isValidScriptName', () => {
  it.each([
    'x',
    '_x',
    'stars',
    'repo_stars',
    'repo-stars',
    'A1',
    '__proto__',
    'constructor',
  ])('accepts %j', (name) => {
    expect(isValidScriptName(name)).toBe(true);
  });

  it.each([
    '',
    '1stars',
    '-stars',
    'repo.stars',
    'repo stars',
    'repo/stars',
    'repo:stars',
    'répo',
    'repo$',
    'x\n',
  ])('rejects %j', (name) => {
    expect(isValidScriptName(name)).toBe(false);
  });
});
