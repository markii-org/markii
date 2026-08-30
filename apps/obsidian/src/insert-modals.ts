import { App, SuggestModal } from 'obsidian';
import type { InsertableComponent } from '@markii/host';
import {
  createChoiceSettlement,
  filterInsertComponentSuggestions,
  insertComponentSuggestions,
} from './insert-component.js';
import type {
  ChoiceSettlement,
  InsertComponentSuggestion,
} from './insert-component.js';

/**
 * Imports `obsidian` — added deliberately to
 * `src/obsidian-import-guard.test.ts`'s allowlist alongside
 * `main.ts`/`view.tsx`/`settings-tab.ts`/`run-modals.ts`. Kept in its own
 * file (like `run-modals.ts`) rather than folded into `main.ts`, since
 * nothing here is unit-testable regardless of which file it lives in — a
 * real `SuggestModal` subclass needs Obsidian's DOM/workspace glue to run
 * at all. Every piece worth testing in isolation (the suggestion shape,
 * the filter, the wording) already lives in `./insert-component.ts`.
 */

/**
 * A component picker, modeled on the deleted `pack-modals.ts`'s
 * `pick(): Promise<...>` shape and on `run-modals.ts`'s pattern of wrapping
 * Obsidian UI with a promise-returning entry point that never re-authors
 * wording of its own. Filters on the directive name
 * (`filterInsertComponentSuggestions`), and shows the directive name plus
 * its one-line description (`renderSuggestion`).
 */
class ComponentSuggestModal extends SuggestModal<InsertComponentSuggestion> {
  private readonly suggestions: readonly InsertComponentSuggestion[];
  private readonly settlement: ChoiceSettlement<InsertableComponent> =
    createChoiceSettlement();

  constructor(app: App, catalog: readonly InsertableComponent[]) {
    super(app);
    this.suggestions = insertComponentSuggestions(catalog);
    this.setPlaceholder('Choose a component to insert');
  }

  getSuggestions(query: string): InsertComponentSuggestion[] {
    return [...filterInsertComponentSuggestions(this.suggestions, query)];
  }

  renderSuggestion(
    suggestion: InsertComponentSuggestion,
    el: HTMLElement,
  ): void {
    // Separate elements rather than one joined string, matching the pack
    // picker this modal is modeled on: `small` is already de-emphasized by
    // Obsidian's own styling, so the row needs no plugin-specific class (and
    // no separator character) to read as a name above its origin tag and
    // description. The detail element is skipped entirely when there is no
    // description, rather than creating an empty node.
    el.createDiv({ text: suggestion.label });
    el.createEl('small', { text: suggestion.origin });
    if (suggestion.detail.length > 0) {
      el.createEl('small', { text: suggestion.detail });
    }
  }

  onChooseSuggestion(suggestion: InsertComponentSuggestion): void {
    this.settlement.choose(suggestion.component);
  }

  override onClose(): void {
    // `SuggestModal.selectSuggestion` closes the modal BEFORE calling
    // `onChooseSuggestion`, so this fires on every selection too, not only
    // on a dismissal (Escape, click-outside). The settlement defers the
    // `undefined` resolution one task so the same-tick choice wins; a real
    // dismissal has no following choice and resolves `undefined`, never
    // leaving the caller's promise hanging. (Issue #23: the previous
    // synchronous resolve here reported every selection as dismissed.)
    this.settlement.dismiss();
  }

  /** Resolves the chosen `InsertableComponent`, or `undefined` when the modal was dismissed. */
  pick(): Promise<InsertableComponent | undefined> {
    this.open();
    return this.settlement.promise;
  }
}

/** Opens the component picker and resolves the chosen component, or `undefined` when dismissed. */
export function pickInsertableComponent(
  app: App,
  catalog: readonly InsertableComponent[],
): Promise<InsertableComponent | undefined> {
  return new ComponentSuggestModal(app, catalog).pick();
}
