import { describe, expect, it } from 'vitest';
import { parse } from './parse';
import { extractScripts } from './scripts';

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
});
