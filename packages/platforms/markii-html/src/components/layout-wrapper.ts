import type { HtmlComponent } from '../registry.js';

/**
 * The closed set of layout-wrapper container names (docs/format.md): six
 * aliases of the one shared implementation below (`createLayoutWrapper`),
 * matching `@markii/react`'s `layout-wrapper.tsx`. There is deliberately no
 * `normal` alias (the default needs no wrapper at all) and no
 * attribute-bearing form.
 */
export const LAYOUT_WRAPPER_PRESETS = [
  'center',
  'left',
  'right',
  'wide',
  'narrow',
  'full',
] as const;

/** One of the six closed layout-wrapper preset names. */
export type LayoutWrapperPreset = (typeof LAYOUT_WRAPPER_PRESETS)[number];

/**
 * Preset -> class string. Null-prototype, mirroring `layout.ts`'s
 * `WIDTH_CLASSES`/`ALIGN_CLASSES`. `center`/`left`/`right` reuse the
 * existing `mk-align-*` classes; `wide`/`narrow`/`full` reuse the existing
 * `mk-width-*` classes. `mk-layout` is the one class every preset adds on
 * top. Matches `@markii/react`'s `WRAPPER_CLASSES` byte-for-byte.
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
  } satisfies Record<LayoutWrapperPreset, string>,
);

/**
 * Creates the registry component for one of docs/format.md's six layout-
 * wrapper container names — `:::center`, `:::left`, `:::right`, `:::wide`,
 * `:::narrow`, `:::full`. One shared implementation, bound to `preset` at
 * registration time, matching `@markii/react`'s `createLayoutWrapper`.
 *
 * Deliberately never reads `attributes`: docs/format.md gives these
 * wrappers no attribute-bearing form. `width`/`align` written on a wrapper
 * are intercepted earlier by the engine's reserved-attribute handling
 * (`layout.ts`), before this component ever runs.
 */
export function createLayoutWrapper(
  preset: LayoutWrapperPreset,
): HtmlComponent {
  const className = WRAPPER_CLASSES[preset] ?? 'mk-layout';

  return (_attributes, childrenHtml) =>
    `<div class="${className}">${childrenHtml}</div>`;
}
