/**
 * Reading and rewriting the links one note makes to another (GitHub issue
 * #28 slice 3, part 2: the cascade export).
 *
 * PURE AND HOST-NEUTRAL. Nothing here touches a vault, a workspace, or a
 * filesystem: it takes a note's text and gives back the links it contains,
 * or a rewritten copy of that text. Resolving a link target to an actual
 * note is the host's job, injected by the caller. That is what lets the
 * Obsidian cascade command and a future VS Code one share this code
 * unchanged, and it keeps every rule about what counts as a link testable
 * without a vault.
 *
 * WHAT COUNTS AS A LINK. Two forms, both of which a note author uses: a
 * wikilink (`[[Other note]]`, `[[Other note|shown text]]`,
 * `[[Other note#a heading]]`) and an ordinary markdown link
 * (`[shown text](other-note.md)`). An embed or image (`![[...]]`,
 * `![](...)`) is deliberately NOT a note link: it is a picture or a
 * transclusion, not a page to walk to. A target with a scheme
 * (`https:`, `mailto:`), a protocol-relative `//host/path`, or a bare
 * fragment (`#section`) is not a note link either.
 *
 * CODE IS NOT CONTENT. A fenced code block or an inline code span that
 * happens to contain `[[...]]` is showing link syntax, not using it, so
 * both are masked out before anything is matched. The mask replaces
 * characters one for one, so every offset this reports still indexes the
 * ORIGINAL text.
 */

/** One link from a note to something else, as written. */
export interface NoteLink {
  /** Which syntax the author used. */
  readonly kind: 'wikilink' | 'markdown';
  /**
   * The link target with any alias and any `#heading` / `^block` fragment
   * removed: the part a host resolves against its vault or workspace.
   * Percent escapes in a markdown target are decoded, so `My%20Note.md`
   * resolves as `My Note.md`.
   */
  readonly path: string;
  /** The `#heading` or `^block` fragment including its leading character, or an empty string. */
  readonly fragment: string;
  /** The text shown to a reader: a wikilink's alias or its target, or a markdown link's label. */
  readonly label: string;
  /** Offset of the link's first character in the original text. */
  readonly start: number;
  /** Offset one past the link's last character in the original text. */
  readonly end: number;
}

/** True when `value` begins with a URL scheme, by the same rule `@markii/core`'s `isSafeUrl` uses: text before the first `:`, but only when that `:` precedes any `/`, `?` or `#`. */
function hasScheme(value: string): boolean {
  const colon = value.indexOf(':');
  if (colon === -1) return false;
  const slash = value.indexOf('/');
  const questionMark = value.indexOf('?');
  const numberSign = value.indexOf('#');
  return (
    (slash === -1 || colon < slash) &&
    (questionMark === -1 || colon < questionMark) &&
    (numberSign === -1 || colon < numberSign)
  );
}

/** True for a target that could name a note in this vault or workspace: a non-empty, local, relative path rather than a URL or a bare fragment. */
export function isLocalNoteTarget(target: string): boolean {
  if (target.length === 0) return false;
  if (target.startsWith('#')) return false;
  if (target.startsWith('//')) return false;
  return !hasScheme(target);
}

/**
 * The mask character. A space cannot begin or continue any link syntax, and
 * replacing one character for one keeps every offset aligned with the
 * original text.
 */
const MASK = ' ';

/**
 * A copy of `text` with every fenced code block and inline code span
 * replaced by mask characters, so link syntax a note is merely DISPLAYING
 * is never mistaken for a link the note makes. Length and offsets are
 * unchanged, and newlines are preserved so line-anchored scanning still
 * works over the masked copy.
 */
export function maskCodeRegions(text: string): string {
  const chars = [...text];
  const mask = (from: number, to: number): void => {
    for (let index = from; index < to && index < chars.length; index += 1) {
      if (chars[index] !== '\n') chars[index] = MASK;
    }
  };

  // Fenced blocks first: a fence's contents are code even when they contain
  // unbalanced backticks that inline scanning would misread.
  const fence = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*$/gm;
  const fenced: [number, number][] = [];
  let openMatch: RegExpExecArray | null;
  while ((openMatch = fence.exec(text)) !== null) {
    const marker = openMatch[1] ?? '';
    const markerChar = marker.startsWith('`') ? '`' : '~';
    const closer = new RegExp(
      `^[ \\t]{0,3}${markerChar}{${String(marker.length)},}[ \\t]*$`,
      'gm',
    );
    closer.lastIndex = openMatch.index + openMatch[0].length;
    const closeMatch = closer.exec(text);
    const bodyEnd = closeMatch
      ? closeMatch.index + closeMatch[0].length
      : text.length;
    fenced.push([openMatch.index, bodyEnd]);
    fence.lastIndex = bodyEnd;
  }
  for (const [from, to] of fenced) mask(from, to);

  // Inline spans, over what is left: a run of N backticks closes at the
  // next run of exactly N.
  let index = 0;
  while (index < chars.length) {
    if (chars[index] !== '`') {
      index += 1;
      continue;
    }
    let runEnd = index;
    while (runEnd < chars.length && chars[runEnd] === '`') runEnd += 1;
    const runLength = runEnd - index;

    let search = runEnd;
    let closeEnd = -1;
    while (search < chars.length) {
      if (chars[search] !== '`') {
        search += 1;
        continue;
      }
      let candidateEnd = search;
      while (candidateEnd < chars.length && chars[candidateEnd] === '`') {
        candidateEnd += 1;
      }
      if (candidateEnd - search === runLength) {
        closeEnd = candidateEnd;
        break;
      }
      search = candidateEnd;
    }

    if (closeEnd === -1) {
      index = runEnd;
      continue;
    }
    mask(index, closeEnd);
    index = closeEnd;
  }

  return chars.join('');
}

/** Splits a target into its path and its `#heading` / `^block` fragment. */
function splitFragment(target: string): { path: string; fragment: string } {
  const hash = target.indexOf('#');
  const caret = target.indexOf('^');
  const cut = hash === -1 ? caret : caret === -1 ? hash : Math.min(hash, caret);
  if (cut === -1) return { path: target, fragment: '' };
  return { path: target.slice(0, cut), fragment: target.slice(cut) };
}

/** Percent-decodes a markdown target, leaving it untouched when it is not valid escaping rather than throwing. */
function decodeTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/** `[[target]]` and `[[target|alias]]`, with a leading `!` captured so an embed can be rejected. */
const WIKILINK_PATTERN = /(!?)\[\[([^\]\n]*)\]\]/g;

/**
 * `[label](target)` and `[label](<target>)`, with an optional `"title"`,
 * and a leading `!` captured so an image can be rejected. The label
 * deliberately allows no nested `]`: a label with brackets in it is left
 * alone rather than guessed at.
 */
const MARKDOWN_LINK_PATTERN =
  /(!?)\[([^\]\n]*)\]\((?:<([^>\n]*)>|([^)\s]*))(?:[ \t]+"[^"\n]*")?\)/g;

/**
 * Every note link in `text`, in document order. Embeds, images, URLs and
 * bare fragments are all excluded, and anything inside code is invisible
 * here.
 */
export function extractNoteLinks(text: string): NoteLink[] {
  const masked = maskCodeRegions(text);
  const links: NoteLink[] = [];
  let match: RegExpExecArray | null;

  WIKILINK_PATTERN.lastIndex = 0;
  while ((match = WIKILINK_PATTERN.exec(masked)) !== null) {
    if (match[1] === '!') continue;
    const inner = match[2] ?? '';
    const pipe = inner.indexOf('|');
    const rawTarget = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
    const alias = pipe === -1 ? undefined : inner.slice(pipe + 1).trim();
    if (!isLocalNoteTarget(rawTarget)) continue;
    const { path, fragment } = splitFragment(rawTarget);
    if (path.length === 0) continue;
    links.push({
      kind: 'wikilink',
      path,
      fragment,
      label: alias !== undefined && alias.length > 0 ? alias : rawTarget,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  MARKDOWN_LINK_PATTERN.lastIndex = 0;
  while ((match = MARKDOWN_LINK_PATTERN.exec(masked)) !== null) {
    if (match[1] === '!') continue;
    const rawTarget = match[3] ?? match[4] ?? '';
    if (!isLocalNoteTarget(rawTarget)) continue;
    const { path, fragment } = splitFragment(decodeTarget(rawTarget));
    if (path.length === 0) continue;
    links.push({
      kind: 'markdown',
      path,
      fragment,
      label: match[2] ?? '',
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return links.sort((left, right) => left.start - right.start);
}

/**
 * Decides one link's replacement destination, or `undefined` to leave the
 * link exactly as the author wrote it. A cascade passes a resolver that
 * answers with the sibling `.html` file name for a note that is in the
 * export, and `undefined` for everything else.
 */
export type NoteLinkTargetResolver = (link: NoteLink) => string | undefined;

/** Escapes the characters that would break out of a markdown link label. */
function escapeLinkLabel(label: string): string {
  return label.replace(/([[\]])/g, '\\$1');
}

/** Escapes the characters that would break out of a markdown link destination, and percent-encodes spaces so the href survives. */
function escapeLinkDestination(destination: string): string {
  return destination.replace(/[()]/g, encodeURIComponent).replace(/ /g, '%20');
}

/**
 * Rewrites every link `resolve` claims, leaving every other byte of `text`
 * untouched.
 *
 * A markdown link keeps its shape and only changes destination. A WIKILINK
 * BECOMES A MARKDOWN LINK, which is a deliberate change and the only way a
 * cascade is navigable: Markii renders CommonMark, where `[[Other note]]`
 * is literal text rather than a link, so leaving wikilinks as written would
 * produce a set of exported pages that cannot reach each other. A wikilink
 * whose target is NOT in the export is left exactly as written, so nothing
 * outside the exported set is ever invented.
 */
export function rewriteNoteLinks(
  text: string,
  resolve: NoteLinkTargetResolver,
): string {
  const links = extractNoteLinks(text);
  let result = text;
  // Right to left, so an earlier link's offsets stay valid as we splice.
  for (let index = links.length - 1; index >= 0; index -= 1) {
    const link = links[index]!;
    const destination = resolve(link);
    if (destination === undefined) continue;
    const href = escapeLinkDestination(destination) + link.fragment;
    const replacement = `[${escapeLinkLabel(link.label)}](${href})`;
    result = result.slice(0, link.start) + replacement + result.slice(link.end);
  }
  return result;
}
