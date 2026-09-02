/**
 * Deciding which of a note's Reading-view SECTIONS gets to render the whole
 * document.
 *
 * Obsidian splits a `.mk.md` note into independent top-level sections (roughly,
 * blocks separated by a blank line) and calls the registered markdown
 * post-processor once per section. A Markii `:::` container can span several
 * of those sections, so rendering each section through `@markii/react`
 * independently would cut a container in half wherever a blank line falls
 * inside it. `./reading-view.ts` avoids that by rendering the ENTIRE note's
 * text once, into the first section Obsidian calls it for, and leaving every
 * later section empty.
 *
 * Obsidian invokes the post-processor for a single render pass in the
 * order its sections appear in the note (top to bottom), so the first call
 * carrying a given `docId` is reliably the note's topmost section. This
 * class only needs to remember that a `docId` has already been claimed;
 * it never needs to compare positions.
 */

export type SectionDecision = 'render' | 'empty';

export class ReadingViewSectionCoordinator {
  private readonly claimed = new Set<string>();

  /**
   * The first call for a given `docId` claims it and is told to render the
   * whole note; every later call for the same `docId` — regardless of how
   * many sections the note was split into — is told to render nothing.
   */
  decide(docId: string): SectionDecision {
    if (this.claimed.has(docId)) return 'empty';
    this.claimed.add(docId);
    return 'render';
  }

  /**
   * Forgets a `docId` once the section that claimed it unloads (Obsidian
   * unloads a section's component when that section is re-rendered, such
   * as on an edit). Without this, a `docId` obsidian happens to reuse would
   * stay permanently claimed and never render again.
   */
  release(docId: string): void {
    this.claimed.delete(docId);
  }
}
