import { App, Modal } from 'obsidian';
import { ALLOW_LABEL, DONT_ALLOW_LABEL } from '@markii/host';
import type { HostPromptRequest } from '@markii/host';

/**
 * Imports `obsidian` — added deliberately to `src/obsidian-import-guard.test.ts`'s
 * allowlist alongside `main.ts`/`view.tsx`/`settings-tab.ts`. Kept in its
 * own file rather than folded into `view.tsx` (which is where these are
 * used) purely to keep that file from growing into the kind of
 * do-everything module `apps/vscode/src/preview-panel.ts` became; nothing
 * here is unit-testable anyway (it's modal UI wiring), so the split costs
 * nothing.
 *
 * BATCH 11: the nine near-identical prompt adapters this file used to
 * carry (`promptHostModal`/`promptUnknownHostsModal`/`promptManyHostsModal`)
 * collapsed into `createObsidianPrompt` below, the one
 * `HostAdapter.prompt` implementation every consequential question —
 * grants, pack install consent, pack replace — routes through. Every
 * message string, and now every button label too, comes straight from the
 * already-built `HostPromptRequest` `@markii/host`'s behavior modules
 * construct (`hostPromptMessage`, `installConsentMessage`, ...); this
 * file only shows them.
 *
 * `confirmModal` (GitHub issue #16) stays as a plain Allow/Don't-allow
 * dialog for a caller with its own message and no `HostPromptRequest` to
 * build (kept for parity with older call sites; new call sites should
 * prefer `createObsidianPrompt`).
 */

/**
 * A minimal modal confirm dialog: a message, an Allow button and a Don't
 * allow button. Resolves `true` for Allow, `false` for Don't allow OR the
 * modal being dismissed any other way (Escape, clicking outside) — a
 * dismissal is a decline, never an implicit grant, matching
 * `apps/vscode/src/preview-panel.ts`'s prompt adapters (a VS Code modal
 * dismissal likewise resolves to `undefined !== ALLOW_LABEL`, i.e. `false`).
 */
class ConfirmModal extends Modal {
  private readonly message: string;
  private readonly allowLabel: string;
  private readonly denyLabel: string;
  private settled = false;
  private resolveChoice: (allowed: boolean) => void = () => {};

  constructor(
    app: App,
    message: string,
    allowLabel: string = ALLOW_LABEL,
    denyLabel: string = DONT_ALLOW_LABEL,
  ) {
    super(app);
    this.message = message;
    this.allowLabel = allowLabel;
    this.denyLabel = denyLabel;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('p', { text: this.message });
    // Obsidian's own `modal-button-container` class carries the flex row
    // and inter-button gap every core dialog uses; a bare div left the two
    // buttons touching. `mod-cta` marks the allow action as the accented
    // one, again matching core dialogs.
    const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
    const allow = buttons.createEl('button', {
      text: this.allowLabel,
      cls: 'mod-cta',
    });
    allow.addEventListener('click', () => this.settle(true));
    const dontAllow = buttons.createEl('button', { text: this.denyLabel });
    dontAllow.addEventListener('click', () => this.settle(false));
  }

  override onClose(): void {
    // A close that never went through `settle` (Escape, click-outside) is a
    // decline — see this class's doc comment.
    this.settle(false);
  }

  private settle(allowed: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveChoice(allowed);
    this.close();
  }

  ask(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolveChoice = resolve;
      this.open();
    });
  }
}

/** A generic Allow/Don't allow confirmation built from a plain message, for a caller that supplies its own wording rather than a `HostPromptRequest`. */
export function confirmModal(app: App, message: string): Promise<boolean> {
  return new ConfirmModal(app, message).ask();
}

/**
 * This plugin's `HostAdapter.prompt` implementation (batch 11): one
 * `ConfirmModal`, shown with exactly the message and button labels the
 * request already carries. Every grant prompt, pack-install consent, and
 * pack-replace confirmation routes through this single function —
 * collapsing the three modal-building functions this file used to export
 * (survey finding A1).
 */
export function createObsidianPrompt(
  app: App,
): (request: HostPromptRequest) => Promise<boolean> {
  return (request: HostPromptRequest) =>
    new ConfirmModal(
      app,
      request.message,
      request.allowLabel,
      request.denyLabel,
    ).ask();
}
