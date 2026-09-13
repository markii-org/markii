import type { AnsiComponent } from '../registry.js';

/**
 * `:kbd[Ctrl+S]` — a styled keycap for an inline text directive. Terminal
 * form: bracketed bold text, e.g. `[Ctrl+S]`. Takes no attributes; its inner
 * content (already rendered plain text) is the key label.
 */
export const Kbd: AnsiComponent = (_attributes, children, ctx) => {
  return `[${ctx.bold(children())}]`;
};
