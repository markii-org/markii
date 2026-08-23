import { DOC_CSS } from './doc-css.generated.js';
import { escapeHtml } from './escape.js';

/**
 * `exportHtmlDocument`'s options. Everything is optional: with no options at
 * all the result is a complete, valid, self-contained HTML document — the
 * "publish a note" default this function exists for (AGENTS.md: `@markii/html`
 * is "for stopped-changing documents (publish/CI/email/archive)").
 */
export interface ExportHtmlDocumentOptions {
  /** The document `<title>`. Defaults to `'Markii document'`. HTML-escaped. */
  title?: string;
  /** The document `<html lang="...">` attribute. Defaults to `'en'`. */
  lang?: string;
  /**
   * Extra CSS appended after the shared `doc.css` (e.g. a host's own theme
   * overrides). Inserted verbatim inside the `<style>` block — this is
   * trusted host-authored CSS, not user content, so it is never escaped.
   */
  extraCss?: string;
}

const DEFAULT_TITLE = 'Markii document';
const DEFAULT_LANG = 'en';

/**
 * Wraps an already-rendered document body (typically `renderMarkToHtml`'s
 * output) in a complete, self-contained HTML document: doctype, `<html>`/
 * `<head>`/`<body>`, a `<meta charset>`, a `<title>`, and a `<style>` block
 * carrying the shared `doc.css` — the same stylesheet `@markii/react` ships
 * (`packages/platforms/markii-react/src/doc.css`), embedded as a generated
 * string constant (`./doc-css.generated.ts`, produced by
 * `scripts/generate-doc-css.ts`) rather than duplicated by hand, so the two
 * renderers can never drift on document rhythm or component internals.
 *
 * `body` is inserted verbatim: it is expected to already be safe HTML (the
 * output of `renderMarkToHtml`/`renderMarkNodeToHtml`, which sanitizes and
 * escapes as it renders) — this function does not re-escape it, exactly as
 * a `<body>` wrapper around already-rendered markup should not. `title` and
 * `lang`, by contrast, ARE escaped/attribute-safe here, since they are
 * ordinary strings a caller may have sourced from frontmatter or user input.
 *
 * The whole class of components this renders (`.doc`'s wrapper) expects a
 * `<div class="doc">` root — callers that pass `renderMarkToHtml`'s raw
 * output (which does not add that wrapper itself) get it added here, so the
 * exported document's rhythm rules apply without every caller having to
 * remember the wrapper class.
 */
export function exportHtmlDocument(
  body: string,
  options: ExportHtmlDocumentOptions = {},
): string {
  const title = options.title ?? DEFAULT_TITLE;
  const lang = options.lang ?? DEFAULT_LANG;
  const css = options.extraCss ? `${DOC_CSS}\n${options.extraCss}` : DOC_CSS;

  return (
    `<!doctype html>\n` +
    `<html lang="${escapeHtml(lang)}">\n` +
    `<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeHtml(title)}</title>\n` +
    `<style>\n${css}\n</style>\n` +
    `</head>\n` +
    `<body>\n` +
    `<div class="doc">\n${body}\n</div>\n` +
    `</body>\n` +
    `</html>\n`
  );
}
