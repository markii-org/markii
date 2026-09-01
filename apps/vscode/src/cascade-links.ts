/**
 * How a link written in one note names another note IN THIS EXTENSION
 * (GitHub issue #36, the `markii.exportHtmlCascade` command).
 *
 * `vscode`-free and path-only, so every rule here is testable without a
 * workspace. `@markii/host`'s `walkNoteCascade` takes a
 * `CascadeLinkResolver` because only a host knows what its own links mean;
 * this module is the VS Code half of that answer, and
 * `preview-panel.ts` adds the two things a string cannot decide: the URI
 * the resolved path belongs to, and whether that URI is inside the roots
 * this extension is willing to read.
 *
 * WHAT COUNTS AS A LINK HERE. Ordinary markdown links relative to the
 * linking note's own folder, `[Other](other.mk.md)` and
 * `[Deeper](sub/deeper.md)`, which is the link form a VS Code workspace
 * uses. Obsidian's wikilinks are a vault concept and have no meaning in a
 * folder of files, so a `[[...]]` target is not resolved here; the walk
 * leaves it exactly as the author wrote it, and so does the export.
 *
 * WHAT IS DELIBERATELY NOT FOLLOWED:
 *
 * - A target starting with `/`. It is not note-relative, and reading it as
 *   workspace-relative would invent a rule VS Code's own markdown preview
 *   only applies with a configured base. Left as written.
 * - A target that climbs above the top of the path it started from. There
 *   is nothing above the root to resolve against, so this reports nothing
 *   rather than guessing. Climbing that stays inside the path but leaves
 *   the workspace is a separate question, answered by the caller's root
 *   check, not here.
 * - A target that names anything but a markdown note. An image, a PDF, or
 *   an extensionless target is not a page to walk to.
 * - A target ending in `/`. That names a folder, not a note.
 */

/** True when `target`'s last segment names a markdown note, `.md` or `.mk.md`, case-insensitively. */
export function isCascadeNoteTarget(target: string): boolean {
  const segment = target.split('/').pop() ?? '';
  const lower = segment.toLowerCase();
  return lower.length > '.md'.length && lower.endsWith('.md');
}

/**
 * The path `target` names when it is written in the note at
 * `fromNotePath`, or `undefined` when it names no note this cascade can
 * follow.
 *
 * Both paths are `/`-separated, exactly the form `vscode.Uri.path` uses,
 * so this needs no `node:path` and behaves identically on every platform.
 * `.` and `..` segments are resolved here rather than left for a file
 * system to interpret, which is what makes the caller's root check
 * meaningful: it sees the real destination, not `a/../../b`.
 */
export function resolveNoteRelativeLink(
  fromNotePath: string,
  target: string,
): string | undefined {
  if (target.length === 0) return undefined;
  if (target.startsWith('/')) return undefined;
  if (target.endsWith('/')) return undefined;
  if (!isCascadeNoteTarget(target)) return undefined;

  const fromSegments = fromNotePath.split('/');
  // The linking note's own folder: everything but its file name.
  const segments = fromSegments.slice(0, -1);
  // An absolute path keeps its leading empty segment, and that segment is
  // the root: `..` may never pop it away. A Windows path arrives from
  // `vscode.Uri.path` as `/c:/notes/a.mk.md`, where the drive is part of
  // the root too, so it is protected the same way.
  let floor = fromNotePath.startsWith('/') ? 1 : 0;
  if (floor === 1 && /^[A-Za-z]:$/.test(segments[1] ?? '')) floor = 2;

  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (segments.length <= floor) return undefined;
      segments.pop();
      continue;
    }
    segments.push(part);
  }

  const resolved = segments.join('/');
  return resolved.length > 0 ? resolved : undefined;
}
