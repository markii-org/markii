import { ItemView, TFile, WorkspaceLeaf } from 'obsidian';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderDocument } from './render-document.js';

export const MARKII_PREVIEW_VIEW_TYPE = 'markii-preview';

const MK_MD_SUFFIX = '.mk.md';

/**
 * Imports `obsidian` — see `src/main.ts`'s file-scope note and
 * `src/obsidian-import-guard.test.ts`. This view is wiring only: it reads
 * the active file's text off the vault and hands it to the plain
 * `renderDocument` (`src/render-document.tsx`), which does the actual
 * `@markii/react` render.
 *
 * Re-renders when the active file changes (`active-leaf-change`) or the
 * currently-shown file's content changes on disk (`vault.on('modify')`) —
 * the two triggers the task calls out. No editor integration, no
 * scripting, no debounce: this is the feasibility spike, not the product.
 */
export class MarkiiPreviewView extends ItemView {
  private root: Root | null = null;
  private currentFile: TFile | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  override getViewType(): string {
    return MARKII_PREVIEW_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return 'Markii Preview';
  }

  override getIcon(): string {
    return 'file-text';
  }

  override async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] ?? this.containerEl;
    container.addClass('mk-obsidian-preview');
    this.root = createRoot(container);

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        void this.refresh();
      }),
    );
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.path === this.currentFile?.path) {
          void this.refresh();
        }
      }),
    );

    await this.refresh();
  }

  override async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }

  private async refresh(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    this.currentFile = file;

    if (!this.root) {
      return;
    }

    if (!file || !file.path.endsWith(MK_MD_SUFFIX)) {
      this.root.render(
        createElement(
          'p',
          { className: 'mk-obsidian-preview__empty' },
          'Open a .mk.md file to preview it here.',
        ),
      );
      return;
    }

    const text = await this.app.vault.cachedRead(file);
    this.root.render(
      createElement('div', { className: 'doc' }, renderDocument(text)),
    );
  }
}
