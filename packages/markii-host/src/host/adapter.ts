/**
 * `HostAdapter`: the minimal set of primitives a host (VS Code, Obsidian,
 * the CLI, or a future one) provides so `createMarkiiHost` can run every
 * shared behavior once. Nothing in this file names a `vscode`, `obsidian`,
 * Electron or TTY type — an adapter is built from injected dependencies,
 * so a test can construct the REAL adapter over fakes (batch 11's
 * `tmp/W11-adapter-design.md`, section 2).
 *
 * A capability group (`isolate`, `editor`, `packs`, `exports`) is absent
 * when a host does not offer it. `createMarkiiHost` never assumes one is
 * present: a behavior whose capability is missing declines with an
 * `Unsupported` outcome and a diagnostics line, per AGENTS.md's "clean is
 * not silent" rule.
 */
import type { GrantMemento } from '../run/grant-flow.js';
import type { IsolateSpawner } from '../run/isolate.js';
import type { LineColumn } from '@markii/stdlib/editor';

/** One entry from `listFolder`. Reuses the shape `@markii/host`'s existing `PackDirectoryLister` (`../packs/discover.ts`) already returns, rather than inventing a second. */
export interface HostDirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

/**
 * One yes/no question. Every grant, consent, and replace prompt in the
 * whole app surface routes through this single method (survey finding A1:
 * nine near-identical prompt adapters across three apps collapse to one
 * call each). `message`, `allowLabel`, and `denyLabel` are already fully
 * built by `@markii/host`; the adapter only has to show them.
 */
export interface HostPromptRequest {
  readonly kind:
    | 'grant-host'
    | 'grant-unknown-hosts'
    | 'grant-many-hosts'
    | 'pack-install-consent'
    | 'pack-replace'
    | 'pack-overwrite-export'
    | 'enable-scripts';
  readonly message: string;
  readonly allowLabel: string;
  readonly denyLabel: string;
  /**
   * `true` for anything authorizing execution or network. A host that can
   * only show a non-blocking surface (the CLI with no TTY, for example)
   * must DENY rather than assume yes — that policy stays the host's own,
   * `HostAdapter.prompt`'s contract only requires it never THROWS.
   */
  readonly consequential: boolean;
}

/**
 * A discriminated union: `workerPath` and `workerBytes` are mutually
 * exclusive per host (survey section C). A Node host (VS Code, the CLI)
 * gives a synchronous path lookup; a host whose runtime cannot create
 * worker threads (an Electron renderer, which is what the Obsidian plugin
 * runs in) gives an async, disposable Web Worker spawner instead.
 */
export type HostIsolate =
  | {
      readonly kind: 'node';
      /**
       * The worker entry on disk. Returning `undefined` means "I have no
       * built worker here", which happens in a development or test run
       * before `dist/` exists; the run path then falls back to its own
       * development entry. A host does not need to know that fallback
       * exists, which is why this may be undefined rather than forcing
       * every host to import it.
       */
      workerPath(): string | undefined;
    }
  | {
      readonly kind: 'browser';
      spawner(): Promise<IsolateSpawner>;
      dispose(): void;
      /**
       * What a browser isolate reports as its entry. A Web Worker started
       * from a blob URL has no path to name, but the run path still labels
       * the entry it handed out, so this supplies that label. It is never
       * resolved or opened. Defaults to `BROWSER_ISOLATE_ENTRY`.
       */
      entryLabel?: string;
    };

/**
 * The entry label a blob-URL Web Worker reports when its host does not
 * supply one. It is a label, never a path: nothing resolves or opens it,
 * and the worker's real bytes come from the blob the host built. It exists
 * because the shared run path always names the entry it handed out, and
 * the alternative (leaving the entry unset) reaches a fallback that is
 * deliberately dev-only and throws in a packaged host.
 */
export const BROWSER_ISOLATE_ENTRY = 'markii:embedded-worker';

export interface HostTextEdit {
  /** Zero-based. */
  readonly line: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly text: string;
}

/**
 * The live editor surface, for hosts that have one. `applyEdits` applies
 * the whole array as ONE undoable edit — both GUI hosts already do this
 * for insertion plus fence extension; stating it here means a third host
 * cannot get it wrong. The CLI omits `editor` entirely: it has no live
 * cursor or edit surface.
 */
export interface HostEditor {
  documentText(): string;
  documentPath(): string | undefined;
  cursor(): LineColumn;
  applyEdits(edits: readonly HostTextEdit[]): Promise<boolean>;
}

/**
 * Pack POLICY (which folders are even candidates) is irreducibly
 * host-specific (survey section D); everything after the list exists is
 * already shared in `../packs/discover.ts` and friends. The adapter
 * supplies only the list and the install destination.
 */
export interface HostPackSource {
  /**
   * Folders this host currently AUTHORIZES: VS Code's resolved
   * `markii.packs` setting plus bundled packs; Obsidian's trust-filtered
   * installed folders plus bundled packs.
   */
  authorizedFolders(): Promise<readonly string[]>;
  /**
   * Namespaces an install may never claim. Empty for VS Code, the bundled
   * three (`read`/`dash`/`prep`) for Obsidian.
   */
  reservedNamespaces(): ReadonlySet<string>;
  /** Where an installed pack is unzipped. Absent means this host cannot install a pack. */
  installRoot?(): string;
  /** Removes an installed pack folder. Required when `installRoot` is present. */
  removeFolder?(path: string): Promise<void>;
}

/** Every export format any host offers today. */
export type HostExportFormat = 'html' | 'pdf' | 'ansi' | 'md-plain';

export interface HostExportCapabilities {
  readonly formats: ReadonlySet<HostExportFormat>;
  /** GUI hosts show a picker; the CLI returns the path it was given. */
  resolveTarget(
    suggestedFileName: string,
    format: HostExportFormat,
  ): Promise<string | undefined>;
  /** Only present on a host declaring `'pdf'`. The one Electron-touching seam. */
  htmlToPdf?(html: string): Promise<Uint8Array>;
}

/**
 * The wording nouns every shared behavior's message templates interpolate
 * (`./labels.ts`). This is the one answer to the survey's wording-drift
 * risk: near-identical copy across the three apps collapses into one
 * template plus these per-host nouns, instead of a per-host
 * reimplementation of the sentence itself.
 */
export interface HostLabels {
  /** "extension" | "plugin" | "command line tool" */
  readonly appNoun: string;
  /** "every Markii preview" | "the Markii preview" | "the rendered note" */
  readonly previewNoun: string;
  /** "the Markii output" | "the Markii diagnostics" | "the run log" */
  readonly diagnosticsSurface: string;
  /** "this workspace" | "this device" */
  readonly deviceNoun: string;
  /**
   * The literal setting a user would toggle to turn script execution back
   * on, when this host exposes one as a named setting (`"markii.scriptsDisabled"`
   * for VS Code). Naming it is how a user finds the switch without opening
   * developer tools (AGENTS.md's "clean is not silent" test), so
   * `./script-execution.ts`'s diagnostics-surface lines include it when
   * present. `undefined` for a host with no single named setting (a
   * command or toggle instead) — the plain sentence is used there.
   */
  readonly settingName?: string;
}

/**
 * Everything an adapter provides. An adapter is constructible from
 * injected dependencies (no module-scope global reads), which is what
 * lets a conformance test build the REAL adapter over a fake editor
 * (batch 11 Phase 3).
 */
export interface HostAdapter {
  readonly id: 'vscode' | 'obsidian' | 'cli' | (string & {});
  readonly labels: HostLabels;

  readFile(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  /** A missing folder resolves to an empty list — never throws, matching the existing `PackDirectoryLister` contract. */
  listFolder(path: string): Promise<readonly HostDirEntry[]>;

  prompt(request: HostPromptRequest): Promise<boolean>;

  /**
   * Device-local state. Structurally the existing `GrantMemento`,
   * unchanged, so VS Code keeps handing `context.workspaceState` straight
   * through with no adapter wrapper at all.
   */
  readonly memento: GrantMemento;

  /** One diagnostics line on this host's designated surface (docs/integration.md). */
  diagnostics(line: string): void;

  now(): number;

  readonly isolate?: HostIsolate;
  readonly editor?: HostEditor;
  readonly packs?: HostPackSource;
  readonly exports?: HostExportCapabilities;
}
