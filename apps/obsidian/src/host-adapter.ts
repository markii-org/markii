/**
 * This plugin's `HostAdapter` (batch 11: `tmp/W11-adapter-design.md`),
 * feeding `@markii/host`'s `createMarkiiHost` (run, pack install, pack
 * load, export). Deliberately `obsidian`-free: it takes every Obsidian
 * primitive it needs as an INJECTED dependency (a prompt function, the
 * local-storage load/save pair, a diagnostics sink, the browser isolate,
 * pack folder policy, export capabilities) rather than importing
 * `obsidian` or reaching for a module-scope global. That is what lets
 * `src/obsidian-import-guard.test.ts` leave this file off its allowlist,
 * and what lets a future test build the REAL adapter over fakes (batch
 * 11 Phase 3's stated requirement).
 *
 * `main.ts`/`view.tsx` (both already on the import-guard allowlist, since
 * they need real Obsidian types) construct the actual dependencies —
 * `app.saveLocalStorage`/`loadLocalStorage` bound, a `ConfirmModal`-backed
 * prompt, `console` sinks — and pass them here.
 *
 * FILE READ/WRITE/LIST. This plugin is desktop-only (`manifest.json`'s
 * `isDesktopOnly: true`), so `node:fs` is always available, exactly as
 * `./packs/archive-packs.ts` and `main.ts` already assume for pack
 * installation. `readFile`/`writeFile` back `HostAdapter`'s minimal
 * `open()`/export-write paths; `listFolder` mirrors the existing
 * `PackDirectoryLister` contract (a missing folder resolves to an empty
 * list, never throws).
 *
 * DIAGNOSTICS PREFIX. `[markii] ` is a property of THIS SINK, not of the
 * shared wording (`@markii/host`'s `create-host.ts` and behavior modules
 * write plain, unprefixed lines) — `./host-adapter.test.ts` pins this.
 */
import {
  mkdir as nodeMkdir,
  readdir as nodeReaddir,
  readFile as nodeReadFile,
  writeFile as nodeWriteFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type {
  GrantMemento,
  HostAdapter,
  HostDirEntry,
  HostEditor,
  HostExportCapabilities,
  HostIsolate,
  HostPackSource,
  HostPromptRequest,
} from '@markii/host';
import { OBSIDIAN_LABELS } from '@markii/host';
import {
  createLocalStorageMemento,
  type MementoWriteFailure,
} from './run/local-storage-memento.js';

/** The `[markii] ` console prefix every diagnostics line this plugin writes gets. See this module's top comment: the prefix is the sink's job, never the shared wording's. */
const DIAGNOSTICS_PREFIX = '[markii] ';

export interface ObsidianHostAdapterDeps {
  /** One yes/no question, wired to a `ConfirmModal` at the call site (`run-modals.ts`). */
  readonly prompt: (request: HostPromptRequest) => Promise<boolean>;
  /** `app.loadLocalStorage.bind(app)` — device-local, never `loadData`. */
  readonly loadLocalStorage: (key: string) => unknown;
  /** `app.saveLocalStorage.bind(app)` — device-local, never `saveData`. */
  readonly saveLocalStorage: (key: string, value: unknown) => void;
  /** Reported when a local-storage write is refused (a full store). See `run/local-storage-memento.ts`. */
  readonly onMementoWriteFailure?: MementoWriteFailure;
  /** The one line sink for this host's designated diagnostics surface (docs/integration.md: the developer console). Receives the line WITHOUT the `[markii] ` prefix; this adapter adds it. */
  readonly diagnostics: (line: string) => void;
  /** Defaults to `Date.now`. Injectable so a test's clock is fixed. */
  readonly now?: () => number;
  readonly isolate?: HostIsolate;
  readonly packs?: HostPackSource;
  readonly exports?: HostExportCapabilities;
  /**
   * The live editor surface, built at the call site from the Obsidian
   * `Editor` API (`view.editor`): `documentText`/`documentPath` from
   * `editor.getValue()`/the active file's path, `cursor` from
   * `editor.getCursor('from')` (the selection start, matching the
   * pre-batch-11 `insertComponent` wiring), and `applyEdits` from
   * `editor.transaction`. Absent when a caller builds an adapter with no
   * active editor (a Run-only or export-only call site).
   */
  readonly editor?: HostEditor;
}

/** A missing folder resolves to an empty list — matches `../packs/discover.ts`'s existing `PackDirectoryLister` contract, never throws. */
async function listFolder(
  folderPath: string,
): Promise<readonly HostDirEntry[]> {
  try {
    const entries = await nodeReaddir(folderPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }));
  } catch {
    return [];
  }
}

/** Builds this plugin's `HostAdapter` from injected dependencies. Constructible with no `obsidian` import in sight — see this module's top comment. */
export function createObsidianHostAdapter(
  deps: ObsidianHostAdapterDeps,
): HostAdapter {
  const memento: GrantMemento = createLocalStorageMemento(
    deps.loadLocalStorage,
    deps.saveLocalStorage,
    deps.onMementoWriteFailure,
  );

  return {
    id: 'obsidian',
    labels: OBSIDIAN_LABELS,

    async readFile(filePath: string): Promise<Uint8Array> {
      return new Uint8Array(await nodeReadFile(filePath));
    },
    async exists(filePath: string): Promise<boolean> {
      return existsSync(filePath);
    },
    async writeFile(filePath: string, bytes: Uint8Array): Promise<void> {
      await nodeMkdir(path.dirname(filePath), { recursive: true });
      await nodeWriteFile(filePath, bytes);
    },
    listFolder,

    prompt: deps.prompt,
    memento,

    diagnostics(line: string): void {
      deps.diagnostics(`${DIAGNOSTICS_PREFIX}${line}`);
    },

    now: deps.now ?? (() => Date.now()),

    ...(deps.isolate !== undefined ? { isolate: deps.isolate } : {}),
    ...(deps.packs !== undefined ? { packs: deps.packs } : {}),
    ...(deps.exports !== undefined ? { exports: deps.exports } : {}),
    ...(deps.editor !== undefined ? { editor: deps.editor } : {}),
  };
}
