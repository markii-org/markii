/**
 * Small, environment-free path helpers for the paths the host layer hands to
 * a `HostAdapter` (`readFile`, `writeFile`, `listFolder`). They are adapter
 * paths, not OS paths: this layer never touches a file system itself, so it
 * must not import `node:path`.
 *
 * They stay correct for a Windows host, where the VS Code adapter does hand
 * over `C:\Users\ana\packs` style strings (from `os.homedir()`, a
 * `globalStorageUri.fsPath`, or a hand-written setting). The separator is
 * taken from the base path: a base that uses backslashes and no forward
 * slashes is a Windows path, joined and split with backslashes (forward
 * slashes inside later segments are accepted as separators too, as
 * `path.win32` does). Any other base is posix.
 */

const DRIVE_PREFIX = /^[A-Za-z]:/;

function separatorOf(path: string): '/' | '\\' {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}

/** True for a rooted path: `/x`, `\x`, `\\server\share`, or `C:\x` / `C:/x`. */
export function isAbsolutePath(path: string): boolean {
  return (
    path.startsWith('/') ||
    path.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(path)
  );
}

interface Parsed {
  readonly root: string;
  readonly segments: string[];
}

function parse(path: string, sep: '/' | '\\'): Parsed {
  const splitter = sep === '\\' ? /[\\/]+/ : /\/+/;
  let root = '';
  let rest = path;
  if (sep === '\\') {
    const drive = DRIVE_PREFIX.exec(rest);
    if (drive) {
      root = drive[0];
      rest = rest.slice(2);
    }
    if (/^[\\/]{2}[^\\/]/.test(path) && root === '') {
      root = '\\\\';
      rest = rest.replace(/^[\\/]+/, '');
    } else if (/^[\\/]/.test(rest)) {
      root += '\\';
    }
  } else if (rest.startsWith('/')) {
    root = '/';
  }
  const segments: string[] = [];
  for (const part of rest.split(splitter)) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      const last = segments[segments.length - 1];
      if (last !== undefined && last !== '..') segments.pop();
      else if (root === '') segments.push('..');
      continue;
    }
    segments.push(part);
  }
  return { root, segments };
}

function format({ root, segments }: Parsed, sep: '/' | '\\'): string {
  const body = segments.join(sep);
  if (body === '') return root === '' ? '.' : root;
  return root + body;
}

/**
 * Joins `base` and `parts` with the separator `base` uses, collapsing `.`,
 * `..` and repeated separators the way `path.join` does. An empty result is
 * `.`.
 */
export function joinPath(base: string, ...parts: string[]): string {
  const sep = separatorOf(base);
  return format(
    parse([base, ...parts].filter((p) => p !== '').join(sep), sep),
    sep,
  );
}

/** The parent folder of `path`, `path.dirname`-style (a root's parent is itself). */
export function dirnamePath(path: string): string {
  const sep = separatorOf(path);
  const parsed = parse(path, sep);
  return format(
    { root: parsed.root, segments: parsed.segments.slice(0, -1) },
    sep,
  );
}
