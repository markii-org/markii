/**
 * Static-export plumbing shared by every host (GitHub issue #28, slice 1):
 * turning one note's text plus its last-run values into a self-contained
 * HTML document, and working out what the resulting file is called.
 *
 * This builds NO renderer of its own. `@markii/html` is the static engine
 * (`packages/platforms/markii-html`): `renderMarkToHtml` walks
 * `@markii/core`'s sanitized hast to an HTML string, and
 * `exportHtmlDocument` wraps that string in the full-page shell with the
 * shared `doc.css` embedded. Everything here is the thin host-neutral layer
 * around those two calls, so the VS Code extension and the Obsidian plugin
 * cannot drift on file naming, on the page CSS an exported file carries, or
 * on how a value store is handed to the engine.
 *
 * WHAT AN EXPORT CONTAINS. The standard component set, with the last run's
 * values baked in wherever a note binds one (`data=`, `:value[...]`), plus
 * every pack component the exporting host has loaded (issue #28 slice 2 —
 * see `buildNoteExport` and `composeNoteHtmlExport` at the bottom of this
 * file). A host with React and a merged registry in front of it renders the
 * body itself and hands the string here; a host with neither falls back to
 * the static engine, where a pack directive comes out as that engine's
 * ordinary unknown-component fallback: a labeled box with the inner
 * markdown still rendered inside it. Nothing crashes and no content is
 * dropped either way; see `@markii/html`'s `render.ts`.
 */
import { escapeHtml, exportHtmlDocument, renderMarkToHtml } from '@markii/html';
import { defaultHtmlRegistry } from '@markii/html/components';
import { createValueStore } from '@markii/runtime';
import { EMPTY_IMAGE_REPORT, embedImagesInHtml } from './image-embed.js';
import type { EmbeddedImageReport, ExportImageReader } from './image-embed.js';
import type { StoredValue } from '@markii/runtime';

/** The last path segment of a `/`-separated path, or the string itself when it has no separator. */
function lastSegment(pathOrName: string): string {
  const separator = pathOrName.lastIndexOf('/');
  return separator === -1 ? pathOrName : pathOrName.slice(separator + 1);
}

/** The canonical Markii file extension, matching `apps/vscode/src/mark-document.ts`'s `MARK_EXTENSION`. */
export const MARK_EXTENSION = '.mk.md';

/** The extensions an export can be written as. */
export type ExportExtension = '.html' | '.pdf';

/**
 * The name used when a note has no usable base name at all — a file called
 * exactly `.mk.md`, or an empty path segment. Rare enough that neither host
 * offers it as a normal path, but a file name is not optional here, so
 * there has to be one rather than an empty string.
 */
export const FALLBACK_EXPORT_BASE_NAME = 'markii-note';

/**
 * The base name an export is built from: the file name with a recognized
 * Markii/markdown extension removed, case-insensitively. `notes.mk.md` and
 * `notes.md` both give `notes`; a name with any other extension keeps it
 * (`notes.txt` gives `notes.txt`), because guessing at an unknown extension
 * would be more surprising than leaving it alone. A `/`-separated path is
 * accepted too: only its last segment is read.
 */
export function exportBaseName(pathOrName: string): string {
  const fileName = lastSegment(pathOrName);
  const lower = fileName.toLowerCase();
  if (lower.endsWith(MARK_EXTENSION)) {
    const base = fileName.slice(0, fileName.length - MARK_EXTENSION.length);
    return base || FALLBACK_EXPORT_BASE_NAME;
  }
  if (lower.endsWith('.md')) {
    const base = fileName.slice(0, fileName.length - '.md'.length);
    return base || FALLBACK_EXPORT_BASE_NAME;
  }
  return fileName || FALLBACK_EXPORT_BASE_NAME;
}

/** The exported file's name for `fileName`: `notes.mk.md` + `.html` gives `notes.html`. */
export function exportedFileName(
  fileName: string,
  extension: ExportExtension,
): string {
  return `${exportBaseName(fileName)}${extension}`;
}

/**
 * The path an export is written to when it lands beside its source note:
 * the same folder, the same base name, the new extension. `notePath` is a
 * `/`-separated path — a `vscode.Uri.path` or an Obsidian vault-relative
 * path, never a platform `fsPath` — so no `node:path` import and no
 * platform branching is needed, and this module stays environment-free.
 */
export function exportedSiblingPath(
  notePath: string,
  extension: ExportExtension,
): string {
  const separator = notePath.lastIndexOf('/');
  const folder = separator === -1 ? '' : notePath.slice(0, separator + 1);
  const fileName = notePath.slice(separator + 1);
  return `${folder}${exportedFileName(fileName, extension)}`;
}

/** The exported document's `<title>`: the note's own base name, so a browser tab and a PDF's metadata name the note rather than the format. */
export function exportDocumentTitle(fileName: string): string {
  return exportBaseName(fileName);
}

/**
 * The page-level CSS an exported file carries in addition to `doc.css`.
 *
 * `doc.css` is deliberately a LIBRARY stylesheet: it styles `.doc` and
 * never claims `:root` or `body`, because hosts embed it into pages they
 * do not own. A standalone exported file has no host to supply the page
 * around it, so this is that page: a ground color, a readable measure, and
 * print rules, all of them host-authored and trusted (they are passed to
 * `exportHtmlDocument` as `extraCss`, which is inserted verbatim).
 *
 * The print block matters more than it looks: the Obsidian PDF command
 * prints exactly this document, so the paper layout is decided here rather
 * than in a host-specific branch. `@page` sets the sheet's own margins
 * (the PDF command has no separate page-setup step of its own), the
 * `break-inside: avoid` list keeps a card/callout/table from splitting
 * across two pages wherever it fits on one, and the collapsed script
 * marker and the VS Code webview's run marker are hidden on paper: both
 * are live-preview affordances (a disclosure toggle, a status line about
 * the last run) that mean nothing on a printed or archived page.
 */

/**
 * The class `composeNoteHtmlExport`/`buildNoteHtmlExport` put on the `.doc`
 * wrapper when `hideScriptBlocks` is on, and the class `EXPORT_PAGE_CSS`'s
 * rule below is scoped to.
 *
 * Both hosts already have this preference (VS Code's
 * `markii.hideScriptBlocks`, Obsidian's "Hide script blocks" setting) for
 * their live preview, hiding only the collapsed `⚙ name` marker and
 * nothing else — a failure a reader needs to see is never hidden along
 * with it. An export carries whichever value the exporting host's own
 * preview was showing, so a note exported with scripts hidden in the
 * editor stays that way in the file.
 */
export const EXPORT_HIDE_SCRIPT_BLOCKS_CLASS = 'mk-export--hide-scripts';

export const EXPORT_PAGE_CSS = `
body {
  margin: 0;
  background: #fff;
}
.doc {
  box-sizing: border-box;
  max-width: 46rem;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 4rem;
}
.doc.${EXPORT_HIDE_SCRIPT_BLOCKS_CLASS} .mk-script {
  display: none;
}
@page {
  margin: 2cm;
}
@media print {
  .doc {
    max-width: none;
    margin: 0;
    padding: 0;
  }
  .doc .mk-card,
  .doc .mk-callout,
  .doc .mk-stat,
  .doc .mk-figure,
  .doc .mk-unknown,
  .doc table {
    break-inside: avoid;
  }
  /* A collapsed \`details\` prints as its summary alone, which loses the
     content the author wrote. On paper there is nothing to expand, so
     every disclosure prints open. */
  .doc details > *:not(summary) {
    display: block;
  }
  .doc .mk-script,
  .doc .mk-preview__run-marker {
    display: none;
  }
}
`;

/** What `buildNoteHtmlExport` needs to turn one note into a standalone file. */
export interface NoteHtmlExportOptions {
  /** The note's full source text. */
  readonly text: string;
  /** The note's file name, used for the document title. A path is accepted; only the last segment is read. */
  readonly fileName: string;
  /**
   * The note's last-run values, exactly as the host persisted them
   * (`readPersistedValues`). Bound components and `:value[...]` markers
   * bake these in. Omitted or empty means the note exports with its
   * standard empty states, which is what a note that has never been run
   * should show.
   */
  readonly values?: Record<string, StoredValue>;
  /** Extra host CSS appended after `doc.css` and `EXPORT_PAGE_CSS`. Trusted, inserted verbatim. */
  readonly extraCss?: string;
  /**
   * Hides the collapsed script marker in the exported file, mirroring the
   * exporting host's own `hideScriptBlocks` preview preference. Defaults to
   * `false`, which exports every script marker exactly as the preview
   * would show it with the preference off.
   */
  readonly hideScriptBlocks?: boolean;
}

/**
 * Renders one note to a complete, self-contained HTML document string.
 *
 * Never throws: `renderMarkToHtml` already returns its own failure fallback
 * rather than propagating, so a caller always gets a document it can write.
 */
export function buildNoteHtmlExport(options: NoteHtmlExportOptions): string {
  return composeNoteHtmlExport({
    bodyHtml: renderStaticBody(options.text, options.values ?? {}),
    fileName: options.fileName,
    ...(options.extraCss !== undefined ? { extraCss: options.extraCss } : {}),
    ...(options.hideScriptBlocks !== undefined
      ? { hideScriptBlocks: options.hideScriptBlocks }
      : {}),
  });
}

/**
 * The static engine's body for one note: `@markii/html` walking
 * `@markii/core`'s sanitized hast to a string, with the last run's values
 * baked in. The one place `renderMarkToHtml` is called, so the static path
 * and every React path's fallback produce the identical body.
 */
function renderStaticBody(
  text: string,
  values: Record<string, StoredValue>,
): string {
  const store =
    Object.keys(values).length > 0 ? createValueStore(values) : undefined;
  return renderMarkToHtml(text, defaultHtmlRegistry, store);
}

/**
 * ISSUE #28 SLICE 2: rendering an export through a host's REACT engine.
 *
 * Slice 1 rendered every export with `@markii/html`, so a pack directive
 * came out as that engine's unknown-component box. The static engine cannot
 * load a pack, because a pack component is a React module. The fix is not a
 * second component system: it is to let a host that ALREADY has React and a
 * merged registry in front of it (both do, for the preview) render the
 * export body with exactly what the preview renders, and hand the resulting
 * STRING back here.
 *
 * That keeps this package React-free. Composition is the host-neutral part
 * (the page shell, `doc.css`, the print rules, the pack stylesheets, the
 * file name), and it needs no renderer at all once it has a body string.
 * The React render itself happens where React already lives: the VS Code
 * webview, and the Obsidian plugin's own renderer process.
 */

/** One loaded pack's emitted stylesheet, as a host already holds it for its preview. */
export interface ExportPackStylesheet {
  /** The pack's namespace, used only to label the block in the exported file. */
  readonly namespace: string;
  /** The stylesheet's text, exactly as the host injects it into its preview. */
  readonly cssText: string;
}

/**
 * Why an export fell back to the static engine. Diagnostics-facing: each
 * host words these itself, since the thing a user would do about it differs
 * per host.
 *
 * - `no-packs`: no pack components were loaded, so the static engine
 *   renders precisely what the React engine would have. Not a degradation.
 * - `no-renderer`: the host had no React surface to render through at all
 *   (VS Code with no preview panel open).
 * - `timeout`: the host's renderer was asked and did not answer in time.
 * - `render-failed`: the renderer answered with a failure, or threw.
 */
export type StaticExportReason =
  'no-packs' | 'no-renderer' | 'timeout' | 'render-failed';

/** Which engine actually rendered an export's body, and what that means. */
export type ExportRenderInfo =
  | {
      readonly engine: 'react';
      /** How many loaded packs contributed components to the registry that rendered this file. */
      readonly packCount: number;
      /** How many of those packs contributed a stylesheet embedded in the file. */
      readonly stylesheetCount: number;
    }
  | {
      readonly engine: 'static';
      readonly reason: StaticExportReason;
      /** The verbatim detail behind a `timeout`/`render-failed`, for the diagnostics surface only. */
      readonly detail?: string;
    };

/** What a host's React renderer returns: the body markup, or why it could not produce one. */
export type ExportBodyResult =
  | { readonly ok: true; readonly html: string }
  | {
      readonly ok: false;
      readonly reason: Extract<StaticExportReason, 'timeout' | 'render-failed'>;
      readonly detail?: string;
    };

/**
 * A host's React render of one note's body, as a string. Given the note's
 * text and the values to bake in, it returns the markup that goes INSIDE
 * the exported document's `.doc` wrapper. It is expected not to throw; one
 * that does is caught here and treated as `render-failed`, so a caller
 * always gets a document it can write.
 */
export type ExportBodyRenderer = (
  text: string,
  values: Record<string, StoredValue>,
) => ExportBodyResult | Promise<ExportBodyResult>;

/**
 * Neutralizes the one sequence that can end a `<style>` element early.
 *
 * Pack CSS is trusted in the security sense (docs/security.md: packs are
 * user-installed), but trusted does not mean well-formed, and a stray
 * `</style` in a pack's stylesheet would close the block and spill the rest
 * of the sheet into the page as text. `<\/style` is a valid CSS escape for
 * the same `/` inside a string, and outside a string a bare `</style` was
 * never valid CSS anyway, so nothing legitimate changes meaning here.
 */
function neutralizeStyleClose(cssText: string): string {
  return cssText.replace(/<\/(style)/gi, '<\\/$1');
}

/** A namespace reduced to what is safe inside a CSS comment label. Pack names are validated kebab-case upstream; this only guarantees the comment cannot be escaped. */
function commentSafeNamespace(namespace: string): string {
  const cleaned = namespace.replace(/[^a-zA-Z0-9._-]/g, '');
  return cleaned.length > 0 ? cleaned : 'pack';
}

/**
 * The pack stylesheets as one CSS block, in the order the host loaded them
 * — the same order its preview injects them, which is what decides the
 * cascade between two packs that style the same thing. Each block is
 * labeled with its pack's namespace so a reader of the exported file can
 * tell whose rules these are.
 *
 * Placed AFTER `doc.css` and `EXPORT_PAGE_CSS` by `composeNoteHtmlExport`,
 * matching docs/packs.md's load order: a pack sees resolved `--mk-*` token
 * values and is not overridden by the document stylesheet's broader rules.
 */
export function packStylesheetsCss(
  sheets: readonly ExportPackStylesheet[],
): string {
  return sheets
    .map(
      (sheet) =>
        `/* pack: ${commentSafeNamespace(sheet.namespace)} */\n${neutralizeStyleClose(sheet.cssText)}`,
    )
    .join('\n');
}

/** What `composeNoteHtmlExport` needs to wrap an already-rendered body in the export shell. */
export interface ComposeNoteHtmlExportOptions {
  /** The rendered body markup that goes inside the `.doc` wrapper. Inserted verbatim; it is expected to be renderer output, already escaped. */
  readonly bodyHtml: string;
  /** The note's file name, used for the document title. A path is accepted; only the last segment is read. */
  readonly fileName: string;
  /** The loaded packs' stylesheets, appended after `doc.css` and `EXPORT_PAGE_CSS`. */
  readonly packStylesheets?: readonly ExportPackStylesheet[];
  /** Extra host CSS, appended after `EXPORT_PAGE_CSS` and before the pack stylesheets. Trusted, inserted verbatim. */
  readonly extraCss?: string;
  /** Hides the collapsed script marker in the exported file. See `NoteHtmlExportOptions.hideScriptBlocks`. Defaults to `false`. */
  readonly hideScriptBlocks?: boolean;
}

/**
 * Wraps an already-rendered body in the standalone export page: the same
 * shell, `doc.css`, and print rules `buildNoteHtmlExport` produces, plus
 * every loaded pack's stylesheet so pack components in the body are styled.
 *
 * Host-neutral and renderer-neutral on purpose: it takes a STRING, so the
 * React path and the static path compose the identical page and can never
 * drift on what an exported file carries.
 */
export function composeNoteHtmlExport(
  options: ComposeNoteHtmlExportOptions,
): string {
  const packCss = packStylesheetsCss(options.packStylesheets ?? []);
  const parts = [EXPORT_PAGE_CSS];
  if (options.extraCss) parts.push(options.extraCss);
  if (packCss) parts.push(packCss);
  return exportHtmlDocument(options.bodyHtml, {
    title: exportDocumentTitle(options.fileName),
    extraCss: parts.join('\n'),
    ...(options.hideScriptBlocks
      ? { docClassName: EXPORT_HIDE_SCRIPT_BLOCKS_CLASS }
      : {}),
  });
}

/** What `buildNoteExport` needs. Everything except `text`/`fileName` is optional; omitting `renderBody` is the plain static export. */
export interface NoteExportBuildRequest {
  /** The note's full source text. */
  readonly text: string;
  /** The note's file name, used for the document title. A path is accepted; only the last segment is read. */
  readonly fileName: string;
  /** The note's last-run values, baked in wherever the note binds one. Omitted or empty exports the note's standard empty states. */
  readonly values?: Record<string, StoredValue>;
  /**
   * The host's React render of the body. Omitted when the host has nothing
   * to render through, in which case `staticReason` says which case that
   * is and the static engine renders instead.
   */
  readonly renderBody?: ExportBodyRenderer;
  /** Why the static engine is being used, when `renderBody` is omitted. Defaults to `no-packs`. */
  readonly staticReason?: StaticExportReason;
  /** The loaded packs' stylesheets. Embedded only when the React path actually rendered the body; the static engine's output never references them. */
  readonly packStylesheets?: readonly ExportPackStylesheet[];
  /** How many loaded packs contributed components to the registry that rendered this file. Diagnostics only. */
  readonly packCount?: number;
  /** Extra host CSS appended after `EXPORT_PAGE_CSS`. Trusted, inserted verbatim. */
  readonly extraCss?: string;
  /**
   * Reads one of the note's local images, so the export can embed it as a
   * `data:` URI and stand on its own (`./image-embed.ts`, issue #28 slice
   * 3). Omitted leaves every image source exactly as the author wrote it,
   * which is slice 2's behavior.
   */
  readonly embedImages?: ExportImageReader;
  /** Hides the collapsed script marker in the exported file. See `NoteHtmlExportOptions.hideScriptBlocks`. Defaults to `false`. */
  readonly hideScriptBlocks?: boolean;
}

/** One built export: the complete document, how it was rendered, and how many values it baked in. */
export interface NoteExportDocument {
  /** The complete, self-contained HTML document. */
  readonly html: string;
  /** Which engine rendered the body, and why when it was the static one. */
  readonly render: ExportRenderInfo;
  /** How many last-run values were baked in. */
  readonly valueCount: number;
  /** What image embedding did, for the host's diagnostics surface. Empty when no `embedImages` reader was offered. */
  readonly images: EmbeddedImageReport;
}

/** The verbatim reason for a thrown value. Diagnostics only, never a notice. */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds one note's standalone export document, through the host's React
 * engine when it offered one and through `@markii/html` otherwise.
 *
 * Never throws and never leaves a caller without a file: a renderer that
 * fails, times out, or throws is classified, recorded in `render`, and
 * replaced by the static engine's output, which is the same document slice
 * 1 produced.
 */
export async function buildNoteExport(
  request: NoteExportBuildRequest,
): Promise<NoteExportDocument> {
  const values = request.values ?? {};
  const valueCount = Object.keys(values).length;

  /**
   * The one place a body becomes a finished document, so image embedding
   * and page composition cannot end up applied on one path and not the
   * other. Images are embedded BEFORE composition, since the page shell is
   * not a place an `<img>` can appear.
   */
  const finish = async (
    bodyHtml: string,
    render: ExportRenderInfo,
    packStylesheets: readonly ExportPackStylesheet[],
  ): Promise<NoteExportDocument> => {
    const embedded = request.embedImages
      ? await embedImagesInHtml(bodyHtml, request.embedImages)
      : { html: bodyHtml, report: EMPTY_IMAGE_REPORT };
    return {
      html: composeNoteHtmlExport({
        bodyHtml: embedded.html,
        fileName: request.fileName,
        packStylesheets,
        ...(request.extraCss !== undefined
          ? { extraCss: request.extraCss }
          : {}),
        ...(request.hideScriptBlocks !== undefined
          ? { hideScriptBlocks: request.hideScriptBlocks }
          : {}),
      }),
      render,
      valueCount,
      images: embedded.report,
    };
  };

  /** The static engine's document. Pack stylesheets are never embedded here: the static body has nothing that would use them. */
  const staticDocument = (
    render: ExportRenderInfo,
  ): Promise<NoteExportDocument> =>
    finish(renderStaticBody(request.text, values), render, []);

  if (!request.renderBody) {
    return staticDocument({
      engine: 'static',
      reason: request.staticReason ?? 'no-packs',
    });
  }

  let result: ExportBodyResult;
  try {
    result = await request.renderBody(request.text, values);
  } catch (error) {
    return staticDocument({
      engine: 'static',
      reason: 'render-failed',
      detail: detailOf(error),
    });
  }

  if (!result.ok) {
    return staticDocument({
      engine: 'static',
      reason: result.reason,
      ...(result.detail !== undefined ? { detail: result.detail } : {}),
    });
  }

  const packStylesheets = request.packStylesheets ?? [];
  return finish(
    result.html,
    {
      engine: 'react',
      packCount: request.packCount ?? packStylesheets.length,
      stylesheetCount: packStylesheets.length,
    },
    packStylesheets,
  );
}

/**
 * Whether `text` contains at least one Markii script fence, i.e. a code
 * fence whose info string names `lua`. Both hosts' export notices use this
 * so a note with no scripts is never told to run itself first.
 */
export function noteHasScripts(text: string): boolean {
  return /^ {0,3}(?:`{3,}|~{3,})[ \t]*lua\b/m.test(text);
}

/**
 * One note a cascade index page links to (GitHub issue #28 slice 3, part
 * 2's `index.html`).
 */
export interface CascadeIndexEntry {
  /**
   * The note's title as shown on the index page — the same base name
   * `exportDocumentTitle` gives that note's own `<title>` tag, so the two
   * pages never name a note two different ways.
   */
  readonly title: string;
  /** The note's exported file name inside the archive, e.g. `week-2.html`. Used as the link's `href`, relative to `index.html`. */
  readonly fileName: string;
}

/** The title `exportHtmlDocument` gives the index page itself, distinct from any exported note's own title. */
const CASCADE_INDEX_TITLE = 'Markii export';

/**
 * Builds a cascade archive's `index.html`: a self-contained document
 * listing every exported note by title, each linking to its own file.
 *
 * A cascade archive has no single note to open first once it is
 * unzipped, and without this a reader has to guess a file name or open the
 * archive's contents blind. `entries` is expected in the same order the
 * cascade walked (root note first, breadth first), which is what makes the
 * list read as a sensible table of contents rather than an alphabetized
 * jumble.
 *
 * Uses the same page shell every exported note gets (`doc.css`,
 * `EXPORT_PAGE_CSS`), so the index reads as part of the same export rather
 * than a bare, unstyled file dropped in beside it.
 */
export function buildCascadeIndexHtml(
  entries: readonly CascadeIndexEntry[],
): string {
  const items = entries
    .map(
      (entry) =>
        `<li><a href="${escapeHtml(entry.fileName)}">${escapeHtml(entry.title)}</a></li>`,
    )
    .join('\n');
  const body = `<ul class="mk-cascade-index">\n${items}\n</ul>`;
  return composeNoteHtmlExport({
    bodyHtml: body,
    fileName: CASCADE_INDEX_TITLE,
  });
}
