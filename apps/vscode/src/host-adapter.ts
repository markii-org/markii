/**
 * VS Code's `HostAdapter` (batch 11, `tmp/W11-adapter-design.md`): the
 * primitives `@markii/host`'s shared behaviors (`runViaAdapter`,
 * `installPackFromArchive`, and friends) need, built from injected
 * dependencies rather than reaching for `vscode` itself.
 *
 * Deliberately `vscode`-FREE: nothing here imports `vscode` or names a
 * `vscode` type, so this module stays unit-testable with Vitest (which
 * cannot resolve `vscode`) and so a future conformance test (batch 11
 * Phase 3) can construct the REAL adapter over fakes. `extension.ts` and
 * `preview-panel.ts` — the only two files this extension allows to import
 * `vscode` — are the ones that build the `vscode`-touching closures
 * (`showPrompt`, file I/O, the worker path, the save dialog) and pass them
 * in here.
 *
 * Every dependency but `memento`, `prompt`, and `diagnostics` is optional:
 * a caller that only needs the Run path (the grant flow, `spawnRun`, the
 * last-run trace) can build an adapter with no `packs`/`exports`/`editor`
 * capability at all, and `createMarkiiHost`'s behaviors already decline
 * cleanly (`Unsupported`, with a diagnostics line) when a capability is
 * absent.
 */
import {
  VSCODE_LABELS,
  type GrantMemento,
  type HostAdapter,
  type HostDirEntry,
  type HostEditor,
  type HostExportCapabilities,
  type HostExportFormat,
  type HostPackSource,
  type HostPromptRequest,
  type HostTextEdit,
  type LineColumn,
} from '@markii/host';

export interface VSCodeHostAdapterDeps {
  /** `context.workspaceState`, structurally a `GrantMemento` already — no wrapper needed. */
  readonly memento: GrantMemento;
  /** Shows one yes/no question (a modal `vscode.window.showWarningMessage`, keyed on `request.kind`/`message`/`allowLabel`/`denyLabel`). Resolves `false` on dismiss, exactly like a declined prompt. */
  readonly prompt: (request: HostPromptRequest) => Promise<boolean>;
  /** Writes one line to this extension's designated diagnostics surface, the "Markii" output channel. */
  readonly diagnostics: (line: string) => void;
  /** Defaults to `Date.now`; a test fake overrides this so a `RunTrace` write is byte-stable. */
  readonly now?: () => number;
  /** This extension's bundled worker path (`./worker-path.ts`'s `resolveWorkerPath`), or `undefined` in a development or test run before `dist/` is built, in which case the shared run path applies its own development fallback. */
  readonly workerPath?: () => string | undefined;
  readonly readFile?: (path: string) => Promise<Uint8Array>;
  readonly exists?: (path: string) => Promise<boolean>;
  readonly writeFile?: (path: string, bytes: Uint8Array) => Promise<void>;
  readonly listFolder?: (path: string) => Promise<readonly HostDirEntry[]>;
  /** Every folder `markii.packs` currently resolves to, plus this extension's bundled packs. Absent when the caller has no need of the `packs` capability (e.g. a Run-only adapter). */
  readonly authorizedFolders?: () => Promise<readonly string[]>;
  /** This extension's own pack-install directory (`preview-panel.ts`'s `installedPacksDir`), or `undefined` when the caller does not need to install packs. */
  readonly installRoot?: () => string;
  readonly removeFolder?: (path: string) => Promise<void>;
  /** Every export format this call site offers (today, always `'html'` alone). */
  readonly exportFormats?: ReadonlySet<HostExportFormat>;
  /** Shows the save dialog and returns the chosen path, or `undefined` on cancel. */
  readonly resolveExportTarget?: (
    suggestedFileName: string,
    format: HostExportFormat,
  ) => Promise<string | undefined>;
  /**
   * The active editor's full text (`vscode.TextEditor.document.getText()`).
   * All four `editor*` deps are read at CALL TIME through these closures,
   * never captured once at adapter-construction time, since VS Code's
   * active editor can change between two commands sharing one adapter
   * instance.
   */
  readonly editorDocumentText?: () => string;
  /** The active document's file path, or `undefined` for an untitled buffer. */
  readonly editorDocumentPath?: () => string | undefined;
  /** The active selection's start position (`editor.selection.start`), zero-based. */
  readonly editorCursor?: () => LineColumn;
  /**
   * Applies every edit as ONE undoable `editor.edit()` call (a single
   * `WorkspaceEdit`/edit-builder transaction), per `HostEditor.applyEdits`'s
   * contract. Resolves `false` on a cancelled or failed edit, never
   * throws.
   */
  readonly editorApplyEdits?: (
    edits: readonly HostTextEdit[],
  ) => Promise<boolean>;
}

async function unavailableRead(path: string): Promise<Uint8Array> {
  throw new Error(`no file reader configured for "${path}"`);
}

async function unavailableWrite(path: string): Promise<void> {
  throw new Error(`no file writer configured for "${path}"`);
}

/**
 * Builds this extension's `HostAdapter` from plain, injected dependencies.
 * `id` is fixed at `'vscode'`; `labels` is always `VSCODE_LABELS`, the one
 * canonical wording set this host's shared behaviors interpolate.
 */
export function createVSCodeHostAdapter(
  deps: VSCodeHostAdapterDeps,
): HostAdapter {
  const isolate = {
    kind: 'node' as const,
    // May be undefined in a development or test run with no `dist/` built
    // yet. The shared run path owns that fallback, so this host does not
    // have to know it exists.
    workerPath: (): string | undefined => deps.workerPath?.(),
  };

  const packs: HostPackSource | undefined =
    deps.authorizedFolders === undefined
      ? undefined
      : {
          authorizedFolders: deps.authorizedFolders,
          reservedNamespaces: () => new Set<string>(),
          ...(deps.installRoot !== undefined
            ? { installRoot: deps.installRoot }
            : {}),
          ...(deps.removeFolder !== undefined
            ? { removeFolder: deps.removeFolder }
            : {}),
        };

  const exports: HostExportCapabilities | undefined =
    deps.exportFormats === undefined || deps.resolveExportTarget === undefined
      ? undefined
      : {
          formats: deps.exportFormats,
          resolveTarget: deps.resolveExportTarget,
        };

  const editor: HostEditor | undefined =
    deps.editorDocumentText === undefined ||
    deps.editorCursor === undefined ||
    deps.editorApplyEdits === undefined
      ? undefined
      : {
          documentText: deps.editorDocumentText,
          documentPath: deps.editorDocumentPath ?? (() => undefined),
          cursor: deps.editorCursor,
          applyEdits: deps.editorApplyEdits,
        };

  return {
    id: 'vscode',
    labels: VSCODE_LABELS,
    readFile: deps.readFile ?? unavailableRead,
    exists: deps.exists ?? (async () => false),
    writeFile: deps.writeFile ?? unavailableWrite,
    listFolder: deps.listFolder ?? (async () => []),
    prompt: deps.prompt,
    memento: deps.memento,
    diagnostics: deps.diagnostics,
    now: deps.now ?? Date.now,
    isolate,
    ...(packs !== undefined ? { packs } : {}),
    ...(exports !== undefined ? { exports } : {}),
    ...(editor !== undefined ? { editor } : {}),
  };
}
