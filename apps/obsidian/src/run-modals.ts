import { App, Modal } from 'obsidian';
import {
  ALLOW_LABEL,
  DONT_ALLOW_LABEL,
  UNKNOWN_HOSTS_PROMPT_MESSAGE,
  hostPromptMessage,
  manyHostsPromptMessage,
} from '@markii/host';

/**
 * Imports `obsidian` — added deliberately to `src/obsidian-import-guard.test.ts`'s
 * allowlist alongside `main.ts`/`view.tsx`/`settings-tab.ts`. Kept in its
 * own file rather than folded into `view.tsx` (which is where these are
 * used) purely to keep that file from growing into the kind of
 * do-everything module `apps/vscode/src/preview-panel.ts` became; nothing
 * here is unit-testable anyway (it's modal UI wiring), so the split costs
 * nothing.
 *
 * Wording is NOT re-authored here: every message string comes straight
 * from `@markii/host`'s exported builders (`hostPromptMessage`,
 * `UNKNOWN_HOSTS_PROMPT_MESSAGE`, `manyHostsPromptMessage`) and its
 * `ALLOW_LABEL`/`DONT_ALLOW_LABEL` button labels — the same ones
 * `apps/vscode/src/preview-panel.ts`'s prompt adapters use, so the wording
 * lives in exactly one place regardless of host.
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
  private settled = false;
  private resolveChoice: (allowed: boolean) => void = () => {};

  constructor(app: App, message: string) {
    super(app);
    this.message = message;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('p', { text: this.message });
    const buttons = contentEl.createDiv({ cls: 'markii-confirm-buttons' });
    const allow = buttons.createEl('button', { text: ALLOW_LABEL });
    allow.addEventListener('click', () => this.settle(true));
    const dontAllow = buttons.createEl('button', { text: DONT_ALLOW_LABEL });
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

/** Prompts once for a specific host, worded exactly as `@markii/host`'s `hostPromptMessage`. */
export function promptHostModal(app: App): (host: string) => Promise<boolean> {
  return (host: string) => new ConfirmModal(app, hostPromptMessage(host)).ask();
}

/** Prompts once for the "this note builds a network address dynamically" consent gate. */
export function promptUnknownHostsModal(app: App): () => Promise<boolean> {
  return () => new ConfirmModal(app, UNKNOWN_HOSTS_PROMPT_MESSAGE).ask();
}

/** Prompts once for the PROMPT-STORM guard's consolidated "many hosts" gate, in place of one modal per host once the distinct static host count exceeds `@markii/host`'s `MAX_HOST_PROMPTS`. */
export function promptManyHostsModal(
  app: App,
): (hostCount: number) => Promise<boolean> {
  return (hostCount: number) =>
    new ConfirmModal(app, manyHostsPromptMessage(hostCount)).ask();
}
