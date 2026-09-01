import type { ComponentType, ReactElement } from 'react';
import { layoutWrapperAxis } from '@markii/stdlib';
import type { LayoutAxis } from '@markii/stdlib';
import type { MarkComponentProps } from '../registry.js';

/**
 * The closed set of layout-wrapper container names (docs/format.md):
 * aliases of the one shared implementation below (`createLayoutWrapper`).
 * Unlike the `width`/`align` *attributes* (`layout.ts`), these are directive
 * *names* — the only way to carry a §4 layout preset to plain markdown that
 * an attribute mechanism structurally cannot reach: a GFM table or a bare
 * `![]()` image has no `{...}` to write `width=`/`align=` into. There is
 * deliberately no `normal` alias, since the default needs no wrapper at all.
 *
 * `left` exists even though it mostly matches the ambient default: it is
 * the only way to OVERRIDE an alignment inherited from an enclosing scope
 * (`:::row{text=center}`'s cascade into its cells) back to left alignment
 * inside one cell — a bare, unwrapped paragraph has no directive of its own
 * to attach such an override to.
 */
/*
 * Deliberately NOT built on the registry alias mechanism (`registry.ts`),
 * despite "alias" appearing in the sentence above in its ordinary English
 * sense. A registry alias maps a name onto ANOTHER REGISTERED NAME plus
 * preset attributes; these map onto no shared public name, so aliasing
 * them would mean inventing one (`:::layout{preset=wide}`) and adding it to
 * the format — more public surface, not less. Seven two-line registry
 * entries sharing one implementation is the simpler arrangement; leave it
 * alone.
 */
export const LAYOUT_WRAPPER_PRESETS = [
  'center',
  'left',
  'right',
  'wide',
  'narrow',
  'full',
  'fit',
] as const;

/** One of the closed layout-wrapper preset names. */
export type LayoutWrapperPreset = (typeof LAYOUT_WRAPPER_PRESETS)[number];

/**
 * Preset -> class string. Null-prototype, mirroring `layout.ts`'s
 * `WIDTH_CLASSES`/`ALIGN_CLASSES`: a lookup can never resolve through the
 * prototype chain to an inherited `Object.prototype` member. `preset` is
 * always one of the literals above — bound once at registration time
 * by `createLayoutWrapper`, never derived from directive input — so this is
 * defense in depth rather than a reachable path, but it keeps the same
 * defensive shape every other closed-enum lookup in this codebase uses.
 *
 * `center`/`left`/`right` reuse the existing `mk-align-*` classes
 * (`layout.ts`'s `ALIGN_CLASSES`, `doc.css`'s alignment rules);
 * `wide`/`narrow`/`full`/`fit` reuse the existing `mk-width-*` classes.
 * `mk-layout` is the one class every preset adds on top, carrying the
 * wrapper-specific rhythm/table rules in `doc.css` that don't belong on the
 * bare `width`/`align` attribute-interception wrapper in `render.tsx`.
 */
const WRAPPER_CLASSES: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    center: 'mk-layout mk-align-center',
    left: 'mk-layout mk-align-left',
    right: 'mk-layout mk-align-right',
    wide: 'mk-layout mk-width-wide',
    narrow: 'mk-layout mk-width-narrow',
    full: 'mk-layout mk-width-full',
    fit: 'mk-layout mk-width-fit',
  } satisfies Record<LayoutWrapperPreset, string>,
);

/**
 * Creates the registry component for one of docs/format.md's layout-
 * wrapper container names — `:::center`, `:::left`, `:::right`, `:::wide`,
 * `:::narrow`, `:::full`, and `:::fit`. One shared implementation, bound to
 * `preset` at registration time (see `components/index.ts`), so each
 * registry entry shares one function body instead of a near-identical copy
 * per preset.
 *
 * A wrapper sets ONE of the two layout axes by its name and takes the OTHER
 * as an attribute (docs/spec.md §3), so `:::center{width=fit}` is centered
 * AND sized to its content. It still never reads `attributes`: `width` and
 * `align` are reserved and are stripped before any component sees them, so
 * `render.tsx` resolves the open axis and hands the result down as the
 * `layoutClassName` prop instead (see `RegistryEntry.layout`). That prop is
 * appended to this wrapper's own classes on the SAME `<div>`, which is the
 * point of the arrangement: one element carrying `mk-layout
 * mk-align-center mk-width-fit`, not a `mk-width-fit` div wrapped around a
 * `mk-layout mk-align-center` one, which would leave `doc.css`'s
 * `.mk-layout > * + *` rhythm rule matching the wrong box. An attribute for
 * the wrapper's OWN axis never arrives here at all: `render.tsx` drops it,
 * so `:::center{align=right}` is simply centered — the name wins.
 *
 * Any other attribute (`:::center{foo=bar}`) is valid directive syntax and
 * is simply never looked at, the same as any attribute a component doesn't
 * declare.
 *
 * Never throws: `preset` is always one of the closed literals, and an
 * empty body (`children` absent) is valid — an empty `<div>` is not an
 * error condition. No outer margin (Architecture rule 4): `.doc > * + *`
 * spaces this wrapper against its siblings, and `.mk-layout > * + *`
 * (`doc.css`) restores rhythm for whatever plain markdown sits inside it.
 */
export function createLayoutWrapper(
  preset: LayoutWrapperPreset,
): ComponentType<MarkComponentProps> {
  const className = WRAPPER_CLASSES[preset] ?? 'mk-layout';

  function LayoutWrapper({
    children,
    layoutClassName,
  }: MarkComponentProps): ReactElement {
    return (
      <div
        className={
          layoutClassName ? `${className} ${layoutClassName}` : className
        }
      >
        {children}
      </div>
    );
  }

  LayoutWrapper.displayName = `LayoutWrapper(${preset})`;
  return LayoutWrapper;
}

/**
 * The layout axis `preset` sets by its own name, read from
 * `@markii/stdlib`'s one classification of the seven wrapper names rather
 * than a second table here. Used by `components/index.ts` to register each
 * wrapper with the right `RegistryEntry.layout`, which is what tells
 * `render.tsx` which axis to drop and which to hand down.
 */
export function layoutWrapperPresetAxis(
  preset: LayoutWrapperPreset,
): LayoutAxis {
  const axis = layoutWrapperAxis(preset);
  if (axis === undefined) {
    // Unreachable for the closed preset list above; a `LayoutWrapperPreset`
    // is by construction one of the seven names `@markii/stdlib` classifies.
    // Kept as a narrowing branch rather than a non-null assertion, which the
    // coding standards rule out.
    throw new Error(`"${preset}" is not a layout-wrapper name`);
  }
  return axis;
}
