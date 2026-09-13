import type { AnsiComponent } from '../registry.js';

/** The visible marker appended to whichever tab is treated as "active" (see this module's doc comment for how that is decided). */
const ACTIVE_MARKER = ' (active)';

/**
 * `::::tabs :::tab{label="..."} ... ::: :::tab{label="..."} ... ::: ::::` —
 * a tabbed panel switcher. A terminal has no click-driven tab switching (see
 * `render.ts`'s top comment on interactive components), so every panel is
 * shown, stacked, in document order — matching `@markii/html`'s `Tabs`
 * faithfulness limitation of showing every panel rather than picking one.
 *
 * "The active tab marked": since every panel is always visible here, this
 * engine treats the FIRST tab (document order) as the one a live host would
 * show before any interaction, and marks only its heading line — every
 * `tab` child's block is joined into `childrenText` with a blank line
 * between them (`render.ts`'s `renderBlocks`), the same separator this
 * engine uses between any two sibling blocks, so splitting on the first
 * blank line reliably finds the boundary between the first tab's block and
 * the rest without needing any information `tabs` does not have.
 */
export const Tabs: AnsiComponent = (_attributes, children) => {
  const childrenText = children();
  if (!childrenText.trim()) return '';

  const blocks = childrenText.split('\n\n');
  const [first, ...rest] = blocks;
  if (first === undefined) return childrenText;

  const lines = first.split('\n');
  lines[0] = `${lines[0] ?? ''}${ACTIVE_MARKER}`;
  return [lines.join('\n'), ...rest].join('\n\n');
};
