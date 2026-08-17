import { Children, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { readDirectiveChild } from '../render.js';
import type { MarkComponentProps } from '../registry.js';
import { DEFAULT_TAB_LABEL, TabPanel } from './tab.js';

const TAB_DIRECTIVE_NAME = 'tab';

interface TabEntry {
  label: string;
  panel: ReactNode;
}

/**
 * Walks `children` (one React node per child directive of the `:::tabs`
 * container) and keeps only the ones that are `tab` directives, reading
 * each one's `label` attribute and pre-rendered body straight off its
 * props via `readDirectiveChild` (`../render`) — the supported way to
 * recognize a specific directive name among not-yet-rendered children (see
 * that function's doc comment for why `child.type` can't be used for this).
 * This is how `Tabs` and `Tab` communicate: `tab` is a real registered
 * directive name (so a bare `::::tab{...}` still renders sensibly via the
 * `Tab` component on its own), and `Tabs` additionally recognizes it by
 * name when it appears as a direct child, without ever invoking `Tab`
 * itself for the panels it renders. Anything that isn't a `tab` directive
 * (stray text, an unrelated directive) is silently skipped rather than
 * throwing — matching the graceful-degradation spirit of the
 * unknown-directive fallback.
 */
function collectTabs(children: ReactNode): TabEntry[] {
  const entries: TabEntry[] = [];
  Children.forEach(children, (child) => {
    const directive = readDirectiveChild(child);
    if (!directive || directive.name !== TAB_DIRECTIVE_NAME) return;
    const label = directive.attributes.label ?? DEFAULT_TAB_LABEL;
    entries.push({ label, panel: directive.children });
  });
  return entries;
}

/**
 * `::::tabs :::tab{label="..."} ... ::: ::::` — a tabbed panel switcher.
 * (The wrapping fence needs more colons than its `tab` children, per the
 * directive container nesting rule — same as `docs/spec.md`'s own nested
 * `callout` example.)
 * Inspects its own React children for `tab` directives (see `collectTabs`)
 * and renders a `role="tablist"` button bar plus the single active panel;
 * clicking a button moves `useState`'s active index. Zero tabs renders
 * nothing (`null`); a stale active index (children shrank since the last
 * render) clamps back to the first tab rather than showing a blank panel.
 * No outer margin: the document stylesheet (`.doc > * + *`) owns spacing
 * between this and its siblings.
 */
export function Tabs({ children }: MarkComponentProps): ReactElement | null {
  const tabs = useMemo(() => collectTabs(children), [children]);
  const [requestedIndex, setRequestedIndex] = useState(0);

  if (tabs.length === 0) return null;

  const activeIndex = requestedIndex < tabs.length ? requestedIndex : 0;

  return (
    <div className="mk-tabs">
      <div className="mk-tabs__list" role="tablist">
        {tabs.map((tab, index) => (
          <button
            key={index}
            type="button"
            role="tab"
            aria-selected={index === activeIndex}
            className={
              index === activeIndex
                ? 'mk-tabs__button mk-tabs__button--active'
                : 'mk-tabs__button'
            }
            onClick={() => setRequestedIndex(index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <TabPanel>{tabs[activeIndex]?.panel}</TabPanel>
    </div>
  );
}
