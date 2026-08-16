import type { ReactElement, ReactNode } from 'react';
import type { MarkComponentProps } from '../registry.js';

/** Default label used when a `tab` directive has no `label` attribute. */
export const DEFAULT_TAB_LABEL = 'Tab';

/**
 * The panel markup a tab shows, shared between `Tab` (rendering itself
 * standalone) and `Tabs` (rendering just the active tab's panel — see
 * `tabs.tsx`'s `collectTabs`/`readDirectiveChild`) so both paths produce
 * identical markup from one place.
 */
export function TabPanel({ children }: { children?: ReactNode }): ReactElement {
  return (
    <div className="mk-tab" role="tabpanel">
      {children}
    </div>
  );
}

/**
 * `:::tab{label="..."} ... :::` — one panel of a `tabs` component
 * (`tabs.tsx`). Rendered standalone (outside a `tabs` parent), it shows its
 * own panel via `TabPanel`. Nested inside `tabs`, `Tabs` instead reads this
 * directive's `label`/body straight off its own not-yet-resolved child
 * element via `readDirectiveChild` (`../render`) and renders `TabPanel`
 * itself for only the active tab — `Tab` the component is never invoked in
 * that path, `tab` the directive name is what `Tabs` recognizes.
 */
export function Tab({ children }: MarkComponentProps): ReactElement {
  return <TabPanel>{children}</TabPanel>;
}
