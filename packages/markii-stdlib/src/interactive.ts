/**
 * The interactive-element marker contract (docs/integration.md): an editor
 * host that renders Markii output as a live-preview widget needs to tell,
 * from a DOM click target, whether it landed on a genuinely interactive
 * control (a tab button, a details/script-marker summary) versus plain text
 * — text reveals the raw source for editing, a control acts instead.
 *
 * `@markii/react` and `@markii/html` both put this attribute on every
 * element they emit that is a real `<button>`, carries `role="tab"` or
 * `role="button"`, or is a `<summary>`. It is also the contract a pack's own
 * component is expected to follow for its own interactive elements — this
 * package carries no enforcement (a pack is arbitrary code), only the one
 * name every renderer and pack should agree on.
 */
export const INTERACTIVE_ATTRIBUTE = 'data-mk-interactive';
