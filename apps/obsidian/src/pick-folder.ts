/**
 * A native folder picker for the pack-folder setting, matching what the VS
 * Code extension gets for free from `vscode.window.showOpenDialog`
 * (`apps/vscode/src/extension.ts`). Typing an absolute path by hand is how
 * a shell-escaped path like `Obsidian\ Github` ends up in the list, naming
 * a folder that does not exist; picking one cannot produce that.
 *
 * `pickPackArchiveFile` (GitHub issue #16) is the same reach, aimed at a
 * single `.mkp` file instead of a folder, for "Install Markii pack from
 * file" (`../main.ts`).
 *
 * Obsidian's own API has no folder picker, so this reaches for Electron's
 * dialog, which the desktop app's renderer exposes. That reach is
 * DEFENSIVE on purpose: the module is resolved at call time, every shape it
 * has been exposed under is tried, and anything unexpected degrades to
 * `undefined` rather than throwing. The caller keeps its text field, so a
 * runtime where this fails is inconvenient, never broken.
 *
 * Deliberately NOT importing `obsidian` (this plugin's file-scope split,
 * `src/obsidian-import-guard.test.ts`), which also keeps it unit-testable:
 * the Electron lookup goes through the injectable `loadElectron` parameter.
 */

/** The slice of Electron's dialog this uses — structural, so a test can satisfy it with a plain object. */
interface OpenDialogLike {
  showOpenDialog(options: {
    properties: string[];
    title?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

interface ElectronLike {
  dialog?: OpenDialogLike;
  remote?: { dialog?: OpenDialogLike };
}

/** Resolves Electron's `dialog` however this runtime happens to expose it, or `undefined`. */
function dialogFrom(electron: unknown): OpenDialogLike | undefined {
  if (typeof electron !== 'object' || electron === null) return undefined;
  const candidate = electron as ElectronLike;
  // `remote.dialog` first: in a renderer that still exposes @electron/remote
  // this is the one wired to the window, while a bare `dialog` there may be
  // the main-process export with no window to parent to.
  const found = candidate.remote?.dialog ?? candidate.dialog;
  return typeof found?.showOpenDialog === 'function' ? found : undefined;
}

/** The default module lookup — separated so tests never touch the real `require`. */
export function loadElectron(): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('electron');
  } catch {
    return undefined;
  }
}

/**
 * Opens a native directory chooser and resolves with the absolute path
 * picked, or `undefined` when the user cancelled or no picker is available.
 * Never throws and never rejects: a failure here must leave the settings
 * tab exactly as it was.
 */
export async function pickFolder(
  load: () => unknown = loadElectron,
): Promise<string | undefined> {
  let dialog: OpenDialogLike | undefined;
  try {
    dialog = dialogFrom(load());
  } catch {
    return undefined;
  }
  if (!dialog) return undefined;

  try {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Choose a pack folder',
    });
    if (result.canceled) return undefined;
    const first = result.filePaths[0];
    return typeof first === 'string' && first.length > 0 ? first : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a native picker is available at all — lets the caller show the Browse button only when it would work. */
export function folderPickerAvailable(
  load: () => unknown = loadElectron,
): boolean {
  try {
    return dialogFrom(load()) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Opens a native file chooser filtered to `.mkp` pack archives, and
 * resolves with the absolute path picked, or `undefined` when the user
 * cancelled or no picker is available. Same never-throw, never-reject
 * contract as `pickFolder`.
 */
export async function pickPackArchiveFile(
  load: () => unknown = loadElectron,
): Promise<string | undefined> {
  let dialog: OpenDialogLike | undefined;
  try {
    dialog = dialogFrom(load());
  } catch {
    return undefined;
  }
  if (!dialog) return undefined;

  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: 'Choose a Markii pack archive',
      filters: [{ name: 'Markii pack', extensions: ['mkp'] }],
    });
    if (result.canceled) return undefined;
    const first = result.filePaths[0];
    return typeof first === 'string' && first.length > 0 ? first : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a native file picker is available at all — same purpose as `folderPickerAvailable`, for the "Install Markii pack from file" command. */
export function packArchivePickerAvailable(
  load: () => unknown = loadElectron,
): boolean {
  return folderPickerAvailable(load);
}
