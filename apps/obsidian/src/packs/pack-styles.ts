/**
 * Injects/removes pack stylesheets in `document.head`, AFTER `styles.css`
 * (this plugin's own stylesheet — `doc.css` plus the Obsidian theme layer,
 * `../obsidian-theme.css` — which Obsidian loads automatically for every
 * enabled plugin before calling its `onload`). docs/packs.md: "A host loads
 * that stylesheet after the document stylesheet and after its own theme
 * layer, so a pack sees resolved theme values and is not overridden by the
 * host's broader rules." Obsidian injects this plugin's `styles.css` as a
 * `<style>` element already present in `document.head` by the time a
 * preview view opens, so simply APPENDING each pack's `<style>` element —
 * DOM insertion order is stylesheet cascade order for same-specificity
 * rules — satisfies the ordering requirement with no special-casing.
 *
 * `obsidian`-free: takes a plain `Document` (or a test double shaped like
 * one), never imports the `obsidian` module.
 */

/** The minimal `Document` surface this module needs — a structural subset, so a test can supply a plain fake instead of a real DOM. */
export interface StyleDocument {
  readonly head: {
    appendChild(node: unknown): void;
  };
  createElement(tagName: string): {
    id: string;
    textContent: string | null;
    remove(): void;
  };
  getElementById(id: string): { remove(): void } | null;
}

/** The `id` a pack's injected `<style>` element gets — namespaced so `removePackStylesheets` can find and remove exactly the elements this module added, and so two packs' stylesheets never collide. */
export function packStyleElementId(namespace: string): string {
  return `markii-pack-style-${namespace}`;
}

/**
 * Appends one `<style>` element per stylesheet in `sheets`, in order, at
 * the end of `doc.head` — after `styles.css`'s own `<style>`/`<link>`
 * element, which Obsidian already inserted before this plugin's `onOpen`
 * ever runs. A sheet whose namespace already has an injected element (a
 * preview reopened without the previous one being removed first — should
 * not happen given `../view.tsx`'s onClose/onOpen pairing, but defensive
 * anyway) replaces it in place rather than appending a duplicate.
 */
export function applyPackStylesheets(
  doc: StyleDocument,
  sheets: ReadonlyArray<{
    readonly namespace: string;
    readonly cssText: string;
  }>,
): void {
  for (const sheet of sheets) {
    const id = packStyleElementId(sheet.namespace);
    doc.getElementById(id)?.remove();
    const styleEl = doc.createElement('style');
    styleEl.id = id;
    styleEl.textContent = sheet.cssText;
    doc.head.appendChild(styleEl);
  }
}

/** Removes every `<style>` element `applyPackStylesheets` added for the given namespaces (`../view.tsx`'s `onClose`, and before loading a fresh pack context on reopen). Missing elements are simply skipped. */
export function removePackStylesheets(
  doc: StyleDocument,
  namespaces: readonly string[],
): void {
  for (const namespace of namespaces) {
    doc.getElementById(packStyleElementId(namespace))?.remove();
  }
}
