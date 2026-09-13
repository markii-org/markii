/**
 * Hand-written argument parser for the `markii` CLI. No dependency: every
 * other module in this app takes what it needs as plain arguments, and this
 * one turns `process.argv.slice(2)` into a typed, closed command shape so
 * nothing downstream has to re-parse or re-validate flags.
 *
 * Every parse failure — an unknown flag, a missing required value, a
 * missing file argument, or an unknown subcommand — comes back as a
 * `'usage-error'` result rather than a thrown error or a silent default:
 * `main.ts` maps that to exit code 3 with the message printed to stderr.
 */

export type ColorFlag = 'auto' | 'never' | '16' | '256' | 'truecolor';
export type ExportFormat = 'html' | 'ansi' | 'md-plain';

export type ParsedCommand =
  | {
      readonly kind: 'view';
      readonly file: string;
      readonly width?: number;
      readonly color?: ColorFlag;
      readonly run: boolean;
      readonly verbose: boolean;
    }
  | {
      readonly kind: 'export';
      readonly file: string;
      readonly format: ExportFormat;
      readonly out: string;
      readonly color?: ColorFlag;
      readonly verbose: boolean;
    }
  | {
      readonly kind: 'run';
      readonly file: string;
      readonly verbose: boolean;
    }
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'usage-error'; readonly message: string };

const COLOR_VALUES: ReadonlySet<string> = new Set([
  'auto',
  'never',
  '16',
  '256',
  'truecolor',
]);
const EXPORT_FORMATS: ReadonlySet<string> = new Set([
  'html',
  'ansi',
  'md-plain',
]);

function isColorFlag(value: string): value is ColorFlag {
  return COLOR_VALUES.has(value);
}

function isExportFormat(value: string): value is ExportFormat {
  return EXPORT_FORMATS.has(value);
}

function usageError(message: string): ParsedCommand {
  return { kind: 'usage-error', message };
}

/** A positive integer (no sign, no decimal, no leading zero requirement) — anything else is rejected by the caller. */
function parsePositiveInteger(value: string): number | undefined {
  if (!/^[1-9][0-9]*$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : undefined;
}

interface Flags {
  help: boolean;
  version: boolean;
  verbose: boolean;
  width?: number;
  color?: ColorFlag;
  noRun: boolean;
  format?: ExportFormat;
  output?: string;
}

/**
 * Splits `argv` into the subcommand name (if any, before the first `--`-
 * terminated flag section is irrelevant here since `--` never introduces a
 * flag section of its own in this grammar) and the remaining tokens. The
 * first token that is not itself a recognized global flag and does not
 * start with `-` is taken as the subcommand name; everything else is
 * collected as positional/flag tokens in original order so flags may appear
 * before or after the subcommand.
 */
function isKnownSubcommand(token: string): token is 'view' | 'export' | 'run' {
  return token === 'view' || token === 'export' || token === 'run';
}

/**
 * Parses the flag/positional tokens shared by every subcommand. `--` ends
 * flag parsing: everything after it is positional, letting a file name that
 * starts with a dash be passed unambiguously (`markii view -- -weird.mk.md`).
 * Returns the collected flags, the positional arguments in order, and an
 * error message the moment an unknown flag or a missing required value is
 * seen (parsing stops there; the caller returns a usage error immediately).
 */
function parseTokens(
  tokens: readonly string[],
): { flags: Flags; positionals: string[] } | { error: string } {
  const flags: Flags = {
    help: false,
    version: false,
    verbose: false,
    noRun: false,
  };
  const positionals: string[] = [];
  let onlyPositionals = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;

    if (onlyPositionals) {
      positionals.push(token);
      continue;
    }

    if (token === '--') {
      onlyPositionals = true;
      continue;
    }

    switch (token) {
      case '--help':
      case '-h':
        flags.help = true;
        continue;
      case '--version':
      case '-V':
        flags.version = true;
        continue;
      case '--verbose':
        flags.verbose = true;
        continue;
      case '--no-run':
        flags.noRun = true;
        continue;
      case '--width': {
        const value = tokens[++i];
        if (value === undefined) {
          return { error: '--width requires a value' };
        }
        const parsed = parsePositiveInteger(value);
        if (parsed === undefined) {
          return {
            error: `--width must be a positive integer, got ${JSON.stringify(value)}`,
          };
        }
        flags.width = parsed;
        continue;
      }
      case '--color': {
        const value = tokens[++i];
        if (value === undefined) {
          return { error: '--color requires a value' };
        }
        if (!isColorFlag(value)) {
          return {
            error: `--color must be one of auto, never, 16, 256, truecolor, got ${JSON.stringify(value)}`,
          };
        }
        flags.color = value;
        continue;
      }
      case '--format': {
        const value = tokens[++i];
        if (value === undefined) {
          return { error: '--format requires a value' };
        }
        if (!isExportFormat(value)) {
          return {
            error: `--format must be one of html, ansi, md-plain, got ${JSON.stringify(value)}`,
          };
        }
        flags.format = value;
        continue;
      }
      case '-o':
      case '--output': {
        const value = tokens[++i];
        if (value === undefined) {
          return { error: `${token} requires a value` };
        }
        flags.output = value;
        continue;
      }
      default:
        if (token.startsWith('-') && token !== '-') {
          return { error: `unknown flag ${JSON.stringify(token)}` };
        }
        positionals.push(token);
    }
  }

  return { flags, positionals };
}

export function parseArgs(argv: readonly string[]): ParsedCommand {
  if (argv.length === 0) {
    return { kind: 'help' };
  }

  const first = argv[0] as string;
  const hasSubcommand = isKnownSubcommand(first);
  const subcommand = hasSubcommand ? first : undefined;
  const rest = hasSubcommand ? argv.slice(1) : argv;

  const parsed = parseTokens(rest);
  if ('error' in parsed) return usageError(parsed.error);
  const { flags, positionals } = parsed;

  if (flags.help) return { kind: 'help' };
  if (flags.version) return { kind: 'version' };

  if (subcommand === undefined) {
    // No known subcommand, no --help/--version: either a bare invocation
    // (already handled above), an unrecognized first token, or a plain
    // usage error.
    if (positionals.length > 0 || argv.length > 0) {
      return usageError(
        `unknown subcommand ${JSON.stringify(first)}; expected view, export, or run`,
      );
    }
    return { kind: 'help' };
  }

  if (subcommand === 'view') {
    const file = positionals[0];
    if (file === undefined) {
      return usageError('markii view requires a file argument');
    }
    return {
      kind: 'view',
      file,
      ...(flags.width !== undefined ? { width: flags.width } : {}),
      ...(flags.color !== undefined ? { color: flags.color } : {}),
      run: !flags.noRun,
      verbose: flags.verbose,
    };
  }

  if (subcommand === 'export') {
    const file = positionals[0];
    if (file === undefined) {
      return usageError('markii export requires a file argument');
    }
    if (flags.format === undefined) {
      return usageError('markii export requires --format <html|ansi|md-plain>');
    }
    if (flags.output === undefined) {
      return usageError('markii export requires -o/--output <file>');
    }
    return {
      kind: 'export',
      file,
      format: flags.format,
      out: flags.output,
      ...(flags.color !== undefined ? { color: flags.color } : {}),
      verbose: flags.verbose,
    };
  }

  // subcommand === 'run'
  const file = positionals[0];
  if (file === undefined) {
    return usageError('markii run requires a file argument');
  }
  return { kind: 'run', file, verbose: flags.verbose };
}
