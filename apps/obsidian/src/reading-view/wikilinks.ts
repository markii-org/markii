/**
 * Converting Obsidian wikilinks (`[[Page]]`, `[[Page|Alias]]`) and embeds
 * (`![[image.png]]`) into ordinary CommonMark links and images, before the
 * note's text reaches `@markii/core`'s parser.
 *
 * The parser only ever sees generic markdown (AGENTS.md's architecture
 * rule 1): it does not know Obsidian's wikilink syntax exists, and it must
 * not be taught it. Rather than growing a wikilink-aware branch in the
 * parser, `./reading-view.ts` (which reads Obsidian's metadata cache and
 * therefore must import `obsidian`) resolves each wikilink's target and
 * hands the plain spans below to `convertWikilinksToMarkdown`, which does
 * the text surgery. That split keeps this module, the one worth unit
 * testing, `obsidian`-free — the same reasoning behind every other
 * `obsidian`-free module in this plugin (see `src/main.ts`'s file-scope
 * note).
 */

/** A reference's position in the raw note text, as UTF-16 code unit offsets — the same unit Obsidian's `Pos.start.offset`/`Pos.end.offset` use. */
export interface WikilinkOffset {
  readonly start: number;
  readonly end: number;
}

/**
 * One wikilink or embed found in a note, in a shape that structurally
 * matches Obsidian's `LinkCache`/`EmbedCache` (a `Reference` plus a
 * `CacheItem`'s `position`) without importing `obsidian` to say so.
 */
export interface WikilinkReference {
  /** The link target as Obsidian's cache names it — `link.link`. */
  readonly link: string;
  /** `link.displayText` — present only for `[[Page|Alias]]`'s `Alias` half. */
  readonly displayText?: string;
  /** `true` for `![[...]]`, `false` for `[[...]]`. */
  readonly isEmbed: boolean;
  /** Where the ORIGINAL wikilink/embed text sits in the note. */
  readonly offset: WikilinkOffset;
}

/**
 * The markdown text one reference becomes. `href` is resolved by the
 * caller (Obsidian's `getFirstLinkpathDest`, falling back to the raw link
 * text for a wikilink that names nothing in the vault — a dead link stays
 * inert rather than breaking the render).
 */
export function markdownForWikilink(
  reference: WikilinkReference,
  href: string,
): string {
  const label = reference.displayText ?? reference.link;
  const prefix = reference.isEmbed ? '!' : '';
  return `${prefix}[${label}](${href})`;
}

/**
 * Replaces every reference's original span in `text` with its markdown
 * form, computed by `resolveHref`. References are applied from the END of
 * the text backward, so replacing one never shifts the offsets of any
 * other still waiting its turn — the same reason any span-splice needs a
 * descending sort.
 *
 * A reference whose offsets fall outside `text` (a stale cache entry from
 * before an edit this call has not caught up with yet) is skipped rather
 * than corrupting the surrounding text; the next re-render, driven by a
 * fresh `getFileCache`, catches up.
 */
export function convertWikilinksToMarkdown(
  text: string,
  references: readonly WikilinkReference[],
  resolveHref: (link: string) => string,
): string {
  const ordered = [...references].sort(
    (a, b) => b.offset.start - a.offset.start,
  );

  let result = text;
  for (const reference of ordered) {
    const { start, end } = reference.offset;
    if (
      start < 0 ||
      end < start ||
      end > result.length ||
      !Number.isInteger(start) ||
      !Number.isInteger(end)
    ) {
      continue;
    }
    const markdown = markdownForWikilink(
      reference,
      resolveHref(reference.link),
    );
    result = result.slice(0, start) + markdown + result.slice(end);
  }
  return result;
}
