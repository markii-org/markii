import { useEffect, useState } from 'react';
import type { GlyphSet } from '../glyphs.js';
import type { ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';
import { bold, dim } from '../ansi.js';
import type { ColorLevel } from '../ansi.js';
import {
  useFocusAnchor,
  useFocusMarker,
  useIsFocused,
  useReportActiveLabel,
} from '../interactive.js';
import type { ElementTabPanel } from '../render.js';

/**
 * `::::tabs :::tab{label="..."} ... ::: :::tab{label="..."} ... ::: ::::` —
 * a tabbed panel switcher, built as a real Ink element (`render.tsx`'s
 * `renderTabsElement` calls this directly rather than going through the
 * ordinary registry-component invocation, so it can hand it real per-panel
 * subtrees — see `registry.ts`'s and `render.tsx`'s doc comments).
 *
 * Non-interactive (the default, and the render-once path): every panel is
 * shown, stacked, in document order, the first one's heading marked
 * `(active)` — matching the pre-Ink engine's faithfulness limitation of
 * showing every panel rather than picking one, since a static render has no
 * way to ask which panel a reader wants.
 *
 * Interactive: only the active panel's body is shown; the header row lists
 * every label, the active one bracketed; left/right or Tab switches it when
 * this `tabs` instance is focused (`useIsFocused`). When this `tabs`
 * instance itself is the FOCUSED component (as opposed to merely being
 * interactive), the whole header strip is drawn in the accent color and
 * prefixed with a `› ` glyph (`useFocusMarker`), so focus is visible even
 * on a theme with no perceptible accent color; an unfocused header strip
 * gets two leading spaces instead, so nothing shifts horizontally when
 * focus moves onto or off of this block.
 */
export interface InteractiveTabsProps {
  panels: readonly ElementTabPanel[];
  color: ColorLevel;
  glyphs: GlyphSet;
  interactive: boolean;
  focusId: number | undefined;
}

export function InteractiveTabs({
  panels,
  color,
  glyphs,
  interactive,
  focusId,
}: InteractiveTabsProps): ReactNode {
  const [active, setActive] = useState(0);
  const focused = useIsFocused(focusId);
  const reportActiveLabel = useReportActiveLabel();
  const anchor = useFocusAnchor(focusId);

  useInput(
    (_input, key) => {
      if (panels.length === 0) return;
      let nextIndex: number | undefined;
      if (key.leftArrow) {
        nextIndex = (active - 1 + panels.length) % panels.length;
      } else if (key.rightArrow || key.tab) {
        nextIndex = (active + 1) % panels.length;
      }
      if (nextIndex === undefined) return;
      setActive(nextIndex);
    },
    { isActive: interactive && focused },
  );

  // Every hook this component calls runs BEFORE the non-interactive early
  // return below, so the hook order is identical in both modes. The header
  // strip is cheap to build and unused in the non-interactive branch; that
  // waste is the price of never making a hook call conditional.
  const activeIndex = Math.min(active, Math.max(0, panels.length - 1));
  const activePanel = panels[activeIndex];
  const activeLabel = activePanel?.label ?? '';
  // Tells the status line which panel is showing. Reported from an effect
  // on the active label itself, so it also follows a re-parse (`--watch`)
  // that changes the panels under a mounted block. The root ignores a
  // report that repeats what it already has, so this cannot loop.
  useEffect(() => {
    if (interactive && focusId !== undefined) {
      reportActiveLabel(focusId, activeLabel);
    }
  }, [interactive, focusId, activeLabel, reportActiveLabel]);
  const strip = panels
    .map((panel, index) => {
      const rendered =
        index === activeIndex
          ? bold(`[${panel.label}]`, color)
          : dim(panel.label, color);
      return index > 0 ? `  ${rendered}` : rendered;
    })
    .join('');
  const focusGlyph = focused ? glyphs.focus : '  ';
  const headingLine = useFocusMarker(`${focusGlyph}${strip}`, focusId);

  if (!interactive) {
    return (
      <Box flexDirection="column">
        {panels.map((panel, index) => (
          <Box key={index} marginTop={index > 0 ? 1 : 0} flexDirection="column">
            <Text>
              {bold(`${panel.label}${index === 0 ? ' (active)' : ''}`, color)}
            </Text>
            {panel.body}
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box ref={anchor} flexDirection="column">
      <Text>{headingLine}</Text>
      {activePanel?.body}
    </Box>
  );
}
