/**
 * The cascade export's pure half (GitHub issue #28 slice 3, part 2):
 * walking the notes one note links to, deciding what each exported file is
 * called, and rewriting the links between them so the exported set is
 * navigable on its own.
 *
 * PURE AND HOST-NEUTRAL, like `./note-links.ts` beside it. Reading a note
 * and resolving a link target to a real note are injected, because only a
 * host knows what a vault or a workspace contains. Obsidian is the first
 * caller (issue #28 slice 3); a VS Code cascade command would supply its
 * own two functions and reuse everything here unchanged. Nothing in this
 * file imports `node:*`, so it stays available to a browser bundle if a
 * host ever needs it there.
 *
 * BOUNDED BY CONSTRUCTION. A note graph has cycles, and a vault can be
 * enormous, so the walk carries three guards a caller cannot switch off:
 * a visited set, a depth limit, and a note-count limit. Hitting a limit is
 * not a failure. The walk stops, says which limit stopped it, and the host
 * writes that to its diagnostics surface, per AGENTS.md's rule that a
 * quiet outcome still has to be discoverable.
 */
import { extractNoteLinks, rewriteNoteLinks } from './note-links.js';
import type { NoteLink } from './note-links.js';
import { exportBaseName } from './note-export.js';

/**
 * How far from the root note a cascade follows links. Four hops covers the
 * shapes people actually build, an index note pointing at sections that
 * point at pages, without turning one command into a whole-vault export.
 */
export const DEFAULT_CASCADE_MAX_DEPTH = 4;

/**
 * How many notes one cascade may export. A second, independent guard: a
 * shallow graph can still be enormously wide, and an archive of a hundred
 * pages is already past what anyone meant by "this note and what it links
 * to".
 */
export const DEFAULT_CASCADE_MAX_NOTES = 100;

/** One note the walk reached. */
export interface CascadeNote {
  /** The note's own path, in whatever form the host resolves and reads. */
  readonly path: string;
  /** The note's full source text. */
  readonly text: string;
  /** Hops from the root note. The root itself is 0. */
  readonly depth: number;
}

/** Reads one note's text, or reports that it could not be read. A reader that throws is treated as unreadable. */
export type CascadeNoteReader = (
  path: string,
) => Promise<string | undefined> | string | undefined;

/**
 * Resolves one link, as written in `fromNotePath`, to the path of a note in
 * this vault or workspace, or `undefined` when it names something that is
 * not a note here. This is where a host puts its own resolution rules: an
 * Obsidian vault resolves a bare note name from anywhere, a folder-relative
 * host resolves against the linking note's folder.
 */
export type CascadeLinkResolver = (
  link: NoteLink,
  fromNotePath: string,
) => string | undefined;

/** Why a walk stopped early. */
export type CascadeTruncation = 'depth' | 'count';

export interface CascadeWalkOptions {
  /** The note the cascade starts from. */
  readonly rootPath: string;
  readonly readNote: CascadeNoteReader;
  readonly resolveLink: CascadeLinkResolver;
  /** Defaults to `DEFAULT_CASCADE_MAX_DEPTH`. */
  readonly maxDepth?: number;
  /** Defaults to `DEFAULT_CASCADE_MAX_NOTES`. */
  readonly maxNotes?: number;
}

export interface CascadeWalkResult {
  /** Every note reached, breadth first, the root note always first. */
  readonly notes: readonly CascadeNote[];
  /** Links that resolved to a note the reader could not read, for the diagnostics surface. */
  readonly unreadable: readonly {
    readonly path: string;
    readonly from: string;
  }[];
  /** Set when a limit stopped the walk before it ran out of links to follow. */
  readonly truncated?: CascadeTruncation;
}

/**
 * Walks the note graph out from `rootPath`, breadth first, and returns
 * every note it reached.
 *
 * Breadth first rather than depth first on purpose: when a limit cuts the
 * walk short, what survives is everything CLOSE to the root, which is what
 * a reader of the root note actually needs.
 *
 * Never throws. A note that cannot be read is recorded and skipped, and a
 * root note that cannot be read simply produces an empty walk, which the
 * caller reports as having nothing to export.
 */
export async function walkNoteCascade(
  options: CascadeWalkOptions,
): Promise<CascadeWalkResult> {
  const maxDepth = options.maxDepth ?? DEFAULT_CASCADE_MAX_DEPTH;
  const maxNotes = options.maxNotes ?? DEFAULT_CASCADE_MAX_NOTES;

  const notes: CascadeNote[] = [];
  const unreadable: { path: string; from: string }[] = [];
  const visited = new Set<string>();
  let truncated: CascadeTruncation | undefined;

  const read = async (path: string): Promise<string | undefined> => {
    try {
      return await options.readNote(path);
    } catch {
      return undefined;
    }
  };

  const rootText = await read(options.rootPath);
  if (rootText === undefined) {
    return { notes: [], unreadable: [{ path: options.rootPath, from: '' }] };
  }
  visited.add(options.rootPath);
  notes.push({ path: options.rootPath, text: rootText, depth: 0 });

  for (let cursor = 0; cursor < notes.length; cursor += 1) {
    const current = notes[cursor]!;
    if (current.depth >= maxDepth) {
      // Only a note that actually has an unfollowed link proves the depth
      // limit changed the outcome, so the flag is set below rather than
      // here.
      const hasLink = extractNoteLinks(current.text).some(
        (link) => options.resolveLink(link, current.path) !== undefined,
      );
      if (hasLink) truncated ??= 'depth';
      continue;
    }

    for (const link of extractNoteLinks(current.text)) {
      const resolved = options.resolveLink(link, current.path);
      if (resolved === undefined) continue;
      if (visited.has(resolved)) continue;
      visited.add(resolved);

      if (notes.length >= maxNotes) {
        truncated ??= 'count';
        continue;
      }

      const text = await read(resolved);
      if (text === undefined) {
        unreadable.push({ path: resolved, from: current.path });
        continue;
      }
      notes.push({ path: resolved, text, depth: current.depth + 1 });
    }
  }

  return {
    notes,
    unreadable,
    ...(truncated !== undefined ? { truncated } : {}),
  };
}

/**
 * The file name each note gets inside the archive: its own base name with
 * an `.html` extension.
 *
 * The archive is flat, so two notes in different folders can want the same
 * name. The first one to be reached keeps it, and each later claimant gets
 * a numeric suffix. The walk is breadth first and deterministic, so the
 * same vault always produces the same names.
 */
export function assignCascadeFileNames(
  paths: readonly string[],
): Map<string, string> {
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const path of paths) {
    const base = exportBaseName(path);
    let candidate = `${base}.html`;
    let counter = 2;
    while (taken.has(candidate.toLowerCase())) {
      candidate = `${base}-${String(counter)}.html`;
      counter += 1;
    }
    taken.add(candidate.toLowerCase());
    names.set(path, candidate);
  }
  return names;
}

/**
 * One note's text with every link to another note IN THIS CASCADE pointed
 * at that note's exported file. A link to anything else, a note outside the
 * walked set or a file that is not a note at all, is left exactly as the
 * author wrote it.
 */
export function rewriteCascadeLinks(
  note: CascadeNote,
  fileNames: ReadonlyMap<string, string>,
  resolveLink: CascadeLinkResolver,
): string {
  return rewriteNoteLinks(note.text, (link) => {
    const resolved = resolveLink(link, note.path);
    if (resolved === undefined) return undefined;
    return fileNames.get(resolved);
  });
}
