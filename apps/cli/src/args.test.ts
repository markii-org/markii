import { describe, expect, it } from 'vitest';
import { parseArgs, type ParsedCommand } from './args.js';

interface Case {
  readonly name: string;
  readonly argv: readonly string[];
  readonly expected: ParsedCommand;
}

const cases: Case[] = [
  {
    name: 'no arguments prints help',
    argv: [],
    expected: { kind: 'help' },
  },
  {
    name: '--help alone',
    argv: ['--help'],
    expected: { kind: 'help' },
  },
  {
    name: '-h alone',
    argv: ['-h'],
    expected: { kind: 'help' },
  },
  {
    name: '--version alone',
    argv: ['--version'],
    expected: { kind: 'version' },
  },
  {
    name: '-V alone',
    argv: ['-V'],
    expected: { kind: 'version' },
  },
  {
    name: '--help after a subcommand still shows help',
    argv: ['view', 'note.mk.md', '--help'],
    expected: { kind: 'help' },
  },
  {
    name: 'plain view',
    argv: ['view', 'note.mk.md'],
    expected: {
      kind: 'view',
      file: 'note.mk.md',
      run: true,
      verbose: false,
      static: false,
      watch: false,
    },
  },
  {
    name: 'view with --width',
    argv: ['view', 'note.mk.md', '--width', '100'],
    expected: {
      kind: 'view',
      file: 'note.mk.md',
      width: 100,
      run: true,
      verbose: false,
      static: false,
      watch: false,
    },
  },
  {
    name: 'view with flags before the file',
    argv: ['view', '--width', '100', '--color', 'never', 'note.mk.md'],
    expected: {
      kind: 'view',
      file: 'note.mk.md',
      width: 100,
      color: 'never',
      run: true,
      verbose: false,
      static: false,
      watch: false,
    },
  },
  {
    name: 'view with --no-run',
    argv: ['view', 'note.mk.md', '--no-run'],
    expected: {
      kind: 'view',
      file: 'note.mk.md',
      run: false,
      verbose: false,
      static: false,
      watch: false,
    },
  },
  {
    name: 'view with --verbose',
    argv: ['view', 'note.mk.md', '--verbose'],
    expected: {
      kind: 'view',
      file: 'note.mk.md',
      run: true,
      verbose: true,
      static: false,
      watch: false,
    },
  },
  {
    name: 'view with every color option',
    argv: ['view', 'note.mk.md', '--color', 'truecolor'],
    expected: {
      kind: 'view',
      file: 'note.mk.md',
      color: 'truecolor',
      run: true,
      verbose: false,
      static: false,
      watch: false,
    },
  },
  {
    name: 'view with --static',
    argv: ['view', 'note.mk.md', '--static'],
    expected: {
      kind: 'view',
      file: 'note.mk.md',
      run: true,
      verbose: false,
      static: true,
      watch: false,
    },
  },
  {
    name: 'view missing file is a usage error',
    argv: ['view'],
    expected: {
      kind: 'usage-error',
      message: 'markii view requires a file argument',
    },
  },
  {
    name: 'view with non-integer --width is a usage error',
    argv: ['view', 'note.mk.md', '--width', 'wide'],
    expected: {
      kind: 'usage-error',
      message: '--width must be a positive integer, got "wide"',
    },
  },
  {
    name: 'view with zero --width is a usage error',
    argv: ['view', 'note.mk.md', '--width', '0'],
    expected: {
      kind: 'usage-error',
      message: '--width must be a positive integer, got "0"',
    },
  },
  {
    name: 'view with negative --width is a usage error',
    argv: ['view', 'note.mk.md', '--width', '-5'],
    expected: {
      kind: 'usage-error',
      message: '--width must be a positive integer, got "-5"',
    },
  },
  {
    name: 'view with --width missing a value is a usage error',
    argv: ['view', 'note.mk.md', '--width'],
    expected: { kind: 'usage-error', message: '--width requires a value' },
  },
  {
    name: 'view with invalid --color is a usage error',
    argv: ['view', 'note.mk.md', '--color', 'rainbow'],
    expected: {
      kind: 'usage-error',
      message:
        '--color must be one of auto, never, 16, 256, truecolor, got "rainbow"',
    },
  },
  {
    name: 'view with --color missing a value is a usage error',
    argv: ['view', 'note.mk.md', '--color'],
    expected: { kind: 'usage-error', message: '--color requires a value' },
  },
  {
    name: 'plain export',
    argv: ['export', 'note.mk.md', '--format', 'html', '-o', 'out.html'],
    expected: {
      kind: 'export',
      file: 'note.mk.md',
      format: 'html',
      out: 'out.html',
      verbose: false,
    },
  },
  {
    name: 'export with --output long flag',
    argv: ['export', 'note.mk.md', '--format', 'ansi', '--output', 'out.ansi'],
    expected: {
      kind: 'export',
      file: 'note.mk.md',
      format: 'ansi',
      out: 'out.ansi',
      verbose: false,
    },
  },
  {
    name: 'export with md-plain and --color',
    argv: [
      'export',
      'note.mk.md',
      '--format',
      'md-plain',
      '-o',
      'out.md',
      '--color',
      'never',
    ],
    expected: {
      kind: 'export',
      file: 'note.mk.md',
      format: 'md-plain',
      out: 'out.md',
      color: 'never',
      verbose: false,
    },
  },
  {
    name: 'export missing --format is a usage error',
    argv: ['export', 'note.mk.md', '-o', 'out.html'],
    expected: {
      kind: 'usage-error',
      message: 'markii export requires --format <html|ansi|md-plain>',
    },
  },
  {
    name: 'export missing -o is a usage error',
    argv: ['export', 'note.mk.md', '--format', 'html'],
    expected: {
      kind: 'usage-error',
      message: 'markii export requires -o/--output <file>',
    },
  },
  {
    name: 'export with invalid --format is a usage error',
    argv: ['export', 'note.mk.md', '--format', 'pdf', '-o', 'out.pdf'],
    expected: {
      kind: 'usage-error',
      message: '--format must be one of html, ansi, md-plain, got "pdf"',
    },
  },
  {
    name: 'export missing file is a usage error',
    argv: ['export', '--format', 'html', '-o', 'out.html'],
    expected: {
      kind: 'usage-error',
      message: 'markii export requires a file argument',
    },
  },
  {
    name: 'plain run',
    argv: ['run', 'note.mk.md'],
    expected: { kind: 'run', file: 'note.mk.md', verbose: false },
  },
  {
    name: 'run with --verbose',
    argv: ['run', 'note.mk.md', '--verbose'],
    expected: { kind: 'run', file: 'note.mk.md', verbose: true },
  },
  {
    name: 'run missing file is a usage error',
    argv: ['run'],
    expected: {
      kind: 'usage-error',
      message: 'markii run requires a file argument',
    },
  },
  {
    name: 'pack install parses the file and --yes',
    argv: ['pack', 'install', 'ana.mkp', '--yes'],
    expected: {
      kind: 'pack-install',
      file: 'ana.mkp',
      yes: true,
      verbose: false,
    },
  },
  {
    name: 'pack install defaults --yes off',
    argv: ['pack', 'install', 'ana.mkp'],
    expected: {
      kind: 'pack-install',
      file: 'ana.mkp',
      yes: false,
      verbose: false,
    },
  },
  {
    name: 'pack list',
    argv: ['pack', 'list'],
    expected: { kind: 'pack-list', verbose: false },
  },
  {
    name: 'pack remove takes a namespace',
    argv: ['pack', 'remove', 'ana'],
    expected: { kind: 'pack-remove', namespace: 'ana', verbose: false },
  },
  {
    name: 'pack install without a file is a usage error',
    argv: ['pack', 'install'],
    expected: {
      kind: 'usage-error',
      message: 'markii pack install requires a .mkp file argument',
    },
  },
  {
    name: 'pack with no action is a usage error',
    argv: ['pack'],
    expected: {
      kind: 'usage-error',
      message: 'markii pack requires install, list, or remove',
    },
  },
  {
    name: 'unknown pack action is a usage error',
    argv: ['pack', 'frob'],
    expected: {
      kind: 'usage-error',
      message: 'unknown pack command "frob"; expected install, list, or remove',
    },
  },
  {
    name: 'unknown subcommand is a usage error',
    argv: ['bogus', 'note.mk.md'],
    expected: {
      kind: 'usage-error',
      message:
        'unknown subcommand "bogus"; expected view, export, run, or pack',
    },
  },
  {
    name: 'unknown flag is a usage error',
    argv: ['view', 'note.mk.md', '--frobnicate'],
    expected: {
      kind: 'usage-error',
      message: 'unknown flag "--frobnicate" for markii view',
    },
  },
  {
    name: '-- lets a file name starting with a dash through',
    argv: ['view', '--', '-weird.mk.md'],
    expected: {
      kind: 'view',
      file: '-weird.mk.md',
      run: true,
      verbose: false,
      static: false,
      watch: false,
    },
  },
  {
    name: '-- with flags before it still parses them',
    argv: ['view', '--width', '90', '--', '-weird.mk.md'],
    expected: {
      kind: 'view',
      file: '-weird.mk.md',
      width: 90,
      run: true,
      verbose: false,
      static: false,
      watch: false,
    },
  },
  {
    name: 'a bare file name starting with a dash without -- is a usage error',
    argv: ['view', '-weird.mk.md'],
    expected: {
      kind: 'usage-error',
      message: 'unknown flag "-weird.mk.md" for markii view',
    },
  },
  {
    name: 'view --box ascii',
    argv: ['view', 'note.mk.md', '--box', 'ascii'],
    expected: {
      kind: 'view',
      file: 'note.mk.md',
      box: 'ascii',
      run: true,
      verbose: false,
      static: false,
      watch: false,
    },
  },
  {
    name: 'export --box unicode',
    argv: [
      'export',
      'note.mk.md',
      '--format',
      'ansi',
      '-o',
      'out.txt',
      '--box',
      'unicode',
    ],
    expected: {
      kind: 'export',
      file: 'note.mk.md',
      format: 'ansi',
      out: 'out.txt',
      box: 'unicode',
      verbose: false,
    },
  },
  {
    name: '--box with an unknown style is a usage error',
    argv: ['view', 'note.mk.md', '--box', 'heavy'],
    expected: {
      kind: 'usage-error',
      message: '--box must be one of unicode, ascii, got "heavy"',
    },
  },
  {
    name: '--box with no value is a usage error',
    argv: ['view', 'note.mk.md', '--box'],
    expected: { kind: 'usage-error', message: '--box requires a value' },
  },
];

describe('parseArgs', () => {
  it.each(cases)('$name', ({ argv, expected }) => {
    expect(parseArgs(argv)).toEqual(expected);
  });
});

describe('flags that do not apply to a subcommand', () => {
  const usage = (message: string) => ({ kind: 'usage-error', message });

  it("accepts exactly each subcommand's own flags", () => {
    expect(parseArgs(['pack', 'list', '--verbose']).kind).toBe('pack-list');
    expect(parseArgs(['pack', 'install', 'a.mkp', '-y']).kind).toBe(
      'pack-install',
    );
    expect(parseArgs(['pack', 'install', 'a.mkp', '--yes']).kind).toBe(
      'pack-install',
    );
    expect(parseArgs(['pack', 'remove', 'ana', '--verbose']).kind).toBe(
      'pack-remove',
    );
    expect(parseArgs(['run', 'n.mk.md', '--verbose']).kind).toBe('run');
    expect(
      parseArgs([
        'export',
        'n.mk.md',
        '--format',
        'ansi',
        '-o',
        'o.txt',
        '--color',
        'never',
        '--box',
        'ascii',
      ]).kind,
    ).toBe('export');
    expect(
      parseArgs([
        'view',
        'n.mk.md',
        '--width',
        '80',
        '--color',
        'never',
        '--box',
        'ascii',
        '--no-run',
        '--static',
        '--watch',
      ]).kind,
    ).toBe('view');
  });

  it('rejects an inapplicable flag on pack list, install, and remove', () => {
    expect(parseArgs(['pack', 'list', '--watch', '--no-run'])).toEqual(
      usage('--watch does not apply to markii pack list'),
    );
    expect(parseArgs(['pack', 'remove', 'ana', '--yes'])).toEqual(
      usage('--yes does not apply to markii pack remove'),
    );
    expect(parseArgs(['pack', 'install', 'a.mkp', '--width', '9'])).toEqual(
      usage('--width does not apply to markii pack install'),
    );
  });

  it('rejects --yes, -y, and the view flags on view, export, and run', () => {
    expect(parseArgs(['view', 'n.mk.md', '-y'])).toEqual(
      usage('-y does not apply to markii view'),
    );
    expect(parseArgs(['run', 'n.mk.md', '--color', 'never'])).toEqual(
      usage('--color does not apply to markii run'),
    );
    expect(
      parseArgs([
        'export',
        'n.mk.md',
        '--format',
        'html',
        '-o',
        'o',
        '--watch',
      ]),
    ).toEqual(usage('--watch does not apply to markii export'));
    expect(parseArgs(['view', 'n.mk.md', '--format', 'html'])).toEqual(
      usage('--format does not apply to markii view'),
    );
    expect(parseArgs(['view', 'n.mk.md', '-o', 'x'])).toEqual(
      usage('-o does not apply to markii view'),
    );
  });

  it('names the subcommand in an unknown-flag error', () => {
    expect(parseArgs(['run', 'n.mk.md', '--nope'])).toEqual(
      usage('unknown flag "--nope" for markii run'),
    );
  });

  it('still lets --help win over an inapplicable flag', () => {
    expect(parseArgs(['pack', 'list', '--watch', '--help'])).toEqual({
      kind: 'help',
    });
  });
});
