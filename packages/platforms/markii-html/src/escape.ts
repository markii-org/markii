/**
 * The five characters that must never reach rendered HTML unescaped. `&`,
 * `<`, and `>` matter in text; `"` and `'` matter inside an attribute value.
 * Escaping all five unconditionally means one function is correct in both
 * places, so a component author calling `ctx.esc` never has to know whether
 * a string is about to land in text or in an attribute.
 */
const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * HTML-escapes a string for safe insertion into either element text or a
 * quoted attribute value. This is the engine's single escaping primitive:
 * the plain-hast serialization is handled by `hast-util-to-html`, and every
 * string a component or the fallback builds by hand goes through here.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]!);
}
