import { App, Modal, SuggestModal } from 'obsidian';
import type { DiscoveredPack } from '@markii/host';
import { overwritePromptMessage } from './packs/build-pack-distribution.js';

/**
 * Imports `obsidian` — added deliberately to `src/obsidian-import-guard.test.ts`'s
 * ALLOWED_FILES alongside `main.ts`/`view.tsx`/`settings-tab.ts`/
 * `run-modals.ts`, for the same reason `run-modals.ts` was: the "Build
 * Markii pack for distribution" command (issue #15, gap 3) needs a pack
 * picker when more than one pack is configured, and an overwrite
 * confirmation before it replaces existing artifacts — both are real
 * Obsidian `Modal`/`SuggestModal` subclasses, which cannot exist without
 * importing `obsidian`, and neither is unit-testable regardless of which
 * file it lives in. Kept in its own file rather than folded into
 * `main.ts` for the same reason `run-modals.ts` is separate: nothing here
 * is testable anyway, so the split costs nothing and keeps `main.ts` from
 * growing into a do-everything module.
 *
 * All the logic worth testing (discovery, wording, byte formatting) lives
 * in `src/packs/build-pack-distribution.ts`; this file is wiring only.
 */

/**
 * Lets the user pick one of several configured packs to build, when the
 * "Build Markii pack for distribution" command finds more than one. A
 * single configured pack skips this modal entirely (`main.ts`'s own
 * check); an empty result (the picker closed without a choice) resolves
 * `undefined` rather than throwing, so the command can simply do nothing
 * more.
 */
class PackPickerModal extends SuggestModal<DiscoveredPack> {
  private readonly packs: readonly DiscoveredPack[];
  private resolveChoice: (pack: DiscoveredPack | undefined) => void = () => {};
  private chosen = false;

  constructor(app: App, packs: readonly DiscoveredPack[]) {
    super(app);
    this.packs = packs;
    this.setPlaceholder('Choose a pack to build for distribution');
  }

  getSuggestions(query: string): DiscoveredPack[] {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [...this.packs];
    return this.packs.filter((pack) =>
      pack.manifest.name.toLowerCase().includes(q),
    );
  }

  renderSuggestion(pack: DiscoveredPack, el: HTMLElement): void {
    el.createEl('div', { text: pack.manifest.name });
    el.createEl('small', { text: pack.folder });
  }

  onChooseSuggestion(pack: DiscoveredPack): void {
    this.chosen = true;
    this.resolveChoice(pack);
  }

  override onClose(): void {
    if (!this.chosen) {
      this.resolveChoice(undefined);
    }
  }

  pick(): Promise<DiscoveredPack | undefined> {
    return new Promise((resolve) => {
      this.resolveChoice = resolve;
      this.open();
    });
  }
}

/** Prompts the user to pick one of `packs` to build, or resolves the single pack directly with no modal at all when there is only one. Resolves `undefined` if the picker is dismissed with no choice made. */
export function pickPackForDistribution(
  app: App,
  packs: readonly DiscoveredPack[],
): Promise<DiscoveredPack | undefined> {
  const [only, ...rest] = packs;
  if (only !== undefined && rest.length === 0) {
    return Promise.resolve(only);
  }
  return new PackPickerModal(app, packs).pick();
}

/**
 * Confirms overwriting artifacts already present in a pack's folder before
 * "Build Markii pack for distribution" writes over them — the
 * `ConfirmPackOverwrite` seam `@markii/host`'s `buildPackForDistribution`
 * calls. Dismissing the modal any other way (Escape, clicking outside) is
 * a decline, matching `run-modals.ts`'s `ConfirmModal`.
 */
class OverwriteConfirmModal extends Modal {
  private readonly packName: string;
  private readonly existingPaths: readonly string[];
  private settled = false;
  private resolveChoice: (proceed: boolean) => void = () => {};

  constructor(app: App, packName: string, existingPaths: readonly string[]) {
    super(app);
    this.packName = packName;
    this.existingPaths = existingPaths;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('p', {
      text: overwritePromptMessage(this.packName, this.existingPaths),
    });
    const list = contentEl.createEl('ul');
    for (const path of this.existingPaths) {
      list.createEl('li', { text: path });
    }
    const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
    const overwrite = buttons.createEl('button', {
      text: 'Overwrite',
      cls: 'mod-cta',
    });
    overwrite.addEventListener('click', () => this.settle(true));
    const cancel = buttons.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.settle(false));
  }

  override onClose(): void {
    this.settle(false);
  }

  private settle(proceed: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveChoice(proceed);
    this.close();
  }

  confirm(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolveChoice = resolve;
      this.open();
    });
  }
}

/** The `ConfirmPackOverwrite` adapter `@markii/host`'s `buildPackForDistribution` calls before overwriting existing artifacts. */
export function confirmPackOverwriteModal(
  app: App,
): (request: {
  readonly packName: string;
  readonly existingPaths: readonly string[];
}) => Promise<boolean> {
  return (request) =>
    new OverwriteConfirmModal(
      app,
      request.packName,
      request.existingPaths,
    ).confirm();
}
