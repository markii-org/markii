/**
 * Truncates `description` to its first sentence, for a picker row that has
 * no room for a contract's full prose. Shared by `./component-catalog.ts`
 * (a component's picker-row description) and `../complete/documentation.ts`
 * (an attribute's completion-row detail), so the sentence-boundary rule
 * lives in exactly one place.
 *
 * A sentence boundary is a period followed by a space AND an uppercase
 * letter, NOT merely ". ". Almost every contract description in
 * `@markii/stdlib` contains "e.g. " before its first real sentence break,
 * and a bare ". " split truncates 19 of the 20 standard components to a
 * row reading "A titled panel, e.g." — the example, which is the useful
 * half, cut off mid-phrase. The uppercase requirement steps over "e.g. `"
 * and "... :::`" alike, because neither is followed by a capital.
 *
 * When no such boundary exists the whole string is returned unchanged: a
 * description that is already one sentence is not worth mangling further.
 */
export function firstSentence(description: string): string {
  const boundary = /\.\s+(?=[A-Z])/.exec(description);
  if (boundary === null) return description;
  return description.slice(0, boundary.index + 1);
}
