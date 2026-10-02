import type { ReactNode } from 'react';

/**
 * Whether `children` amounts to no content at all — `undefined`/`null`/
 * `false`, an all-whitespace string, or an array whose members are all
 * themselves empty by this same test (recursing through the arrays
 * hast-util-to-jsx-runtime produces for a directive with zero or
 * whitespace-only inner markdown). Used to detect an `inline: true` component
 * written with nothing between its brackets/braces (`::badge{label="x"}`
 * instead of `:badge[x]`), and to decide whether an inline fallback's label
 * gets a separator before its content.
 */
export function isEmptyContent(children: ReactNode): boolean {
  if (children === undefined || children === null || children === false) {
    return true;
  }
  if (typeof children === 'string') return children.trim() === '';
  if (Array.isArray(children)) {
    return (children as ReactNode[]).every((child) => isEmptyContent(child));
  }
  return false;
}
