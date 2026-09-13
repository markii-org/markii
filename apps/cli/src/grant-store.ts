/**
 * The device-local `GrantMemento` for the CLI: a single JSON file,
 * `state.json`, under a per-platform config directory.
 *
 * The file is named for what it holds, which is more than grants.
 * `@markii/host` writes a host's whole device-local run record through this
 * one seam: the network grants a user gave by hand, each note's last-run
 * values, its bundle cache snapshot, and the trace of its last run. Naming
 * the file after only the first of those would invite a reader to delete it
 * to reset permissions and silently lose their notes' data as well.
 *
 * This module is the SHAPE
 * gate only — it guarantees the file, once read, is a plain object with no
 * prototype-pollution surface. It is not the security policy: `@markii/host`'s
 * `readGrant` (`grant-flow.ts`) re-validates every stored host against
 * today's rules on top of whatever this module hands back, and that
 * re-validation is not duplicated here.
 *
 * The file is UNTRUSTED INPUT: it lives on disk, a user (or another
 * process) can hand-edit it, and this module must never let a malformed or
 * hostile file crash a run or escalate into prototype pollution. Every
 * read failure — missing file, unreadable file, malformed JSON, or a JSON
 * top level that isn't a plain object — degrades to an empty store, never
 * a thrown error.
 */
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import * as path from 'node:path';
import type { GrantMemento, Thenable } from '@markii/host';

/**
 * Where the CLI's grant file lives, per platform. Pure: takes `env` and
 * `platform` explicitly and reads neither itself, so it stays testable
 * without touching the real environment or `os.platform()`.
 *
 * - `darwin`: `$HOME/Library/Application Support/markii`
 * - `win32`: `%APPDATA%/markii`
 * - everything else (Linux and other Unix-likes): `$XDG_CONFIG_HOME/markii`
 *   when `XDG_CONFIG_HOME` is set to an absolute path, otherwise
 *   `$HOME/.config/markii`.
 */
export function grantStoreDirectory(
  env: Record<string, string | undefined>,
  platform: string,
): string {
  if (platform === 'darwin') {
    const home = env.HOME ?? '';
    return path.join(home, 'Library', 'Application Support', 'markii');
  }
  if (platform === 'win32') {
    const appData = env.APPDATA;
    if (appData !== undefined && appData !== '') {
      return path.join(appData, 'markii');
    }
    const home = env.USERPROFILE ?? env.HOME ?? '';
    return path.join(home, 'AppData', 'Roaming', 'markii');
  }
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg !== undefined && path.isAbsolute(xdg)) {
    return path.join(xdg, 'markii');
  }
  const home = env.HOME ?? '';
  return path.join(home, '.config', 'markii');
}

/** The one name for the CLI's device-local state file. `main.ts` imports this rather than repeating the literal. */
export const CLI_STATE_FILE_NAME = 'state.json';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads `filePath` into a null-prototype store, or an empty null-prototype
 * store on any failure. Built with `Object.create(null)` and copied key by
 * key (never a spread or `Object.assign` onto a `{}` literal) so a stored
 * `__proto__` key lands as an ordinary own property rather than mutating
 * the object's prototype — the prototype-pollution resistance this module
 * promises.
 */
function readStoreSync(filePath: string): Record<string, unknown> {
  const empty = Object.create(null) as Record<string, unknown>;
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return empty;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!isPlainObject(parsed)) return empty;
  const store = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(parsed)) {
    if (Object.hasOwn(parsed, key)) {
      store[key] = parsed[key];
    }
  }
  return store;
}

function ensureDirSync(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** Writes `store` to `filePath` atomically: a temporary sibling is written first (mode 0o600), then renamed over the real path — a reader never observes a partially written file. */
function writeStoreAtomicSync(
  filePath: string,
  store: Record<string, unknown>,
): void {
  const dir = path.dirname(filePath);
  ensureDirSync(dir);
  const tmpName = `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  const tmpPath = path.join(dir, tmpName);
  const json = JSON.stringify(store);
  writeFileSync(tmpPath, json, { mode: 0o600 });
  // `writeFileSync`'s `mode` option is subject to the process umask; an
  // explicit `chmod` guarantees 0o600 regardless of umask.
  chmodSync(tmpPath, 0o600);
  renameSync(tmpPath, filePath);
}

/**
 * A `GrantMemento` backed by a JSON file at `filePath`. Reads the file once
 * at creation (a CLI invocation is short-lived, so there is nothing to
 * gain from re-reading on every `get`); every `update` writes through to
 * disk immediately and atomically, and never throws — a write failure
 * (permissions, a read-only filesystem, disk full) is swallowed, so a
 * grant that can't be persisted still applies for the remainder of this
 * process instead of crashing the run.
 */
export function createFileGrantMemento(filePath: string): GrantMemento {
  let store = readStoreSync(filePath);

  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      return Object.hasOwn(store, key) ? (store[key] as T) : defaultValue;
    },
    update(key: string, value: unknown): Thenable<void> {
      const next = Object.create(null) as Record<string, unknown>;
      for (const k of Object.keys(store)) {
        next[k] = store[k];
      }
      if (value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
      store = next;
      try {
        writeStoreAtomicSync(filePath, store);
      } catch {
        // Never throw — see this function's doc comment.
      }
      return Promise.resolve();
    },
  };
}
