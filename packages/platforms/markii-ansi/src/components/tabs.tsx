import { useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';
import { bold, dim } from '../ansi.js';
import type { ColorLevel } from '../ansi.js';
import { useIsFocused } from '../interactive.js';
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
 * every label, the active one in the accent color; left/right or Tab
 * switches it when this `tabs` instance is focused (`useIsFocused`).
 */
export interface InteractiveTabsProps {
  panels: readonly ElementTabPanel[];
  color: ColorLevel;
  interactive: boolean;
  focusId: number | undefined;
}

export function InteractiveTabs({
  panels,
  color,
  interactive,
  focusId,
}: InteractiveTabsProps): ReactNode {
  const [active, setActive] = useState(0);
  const focused = useIsFocused(focusId);

  useInput(
    (_input, key) => {
      if (key.leftArrow) {
        setActive((current) => (current - 1 + panels.length) % panels.length);
      } else if (key.rightArrow || key.tab) {
        setActive((current) => (current + 1) % panels.length);
      }
    },
    { isActive: interactive && focused },
  );

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

  const activeIndex = Math.min(active, Math.max(0, panels.length - 1));
  const activePanel = panels[activeIndex];
  return (
    <Box flexDirection="column">
      <Box>
        {panels.map((panel, index) => (
          <Text key={index}>
            {index > 0 ? '  ' : ''}
            {index === activeIndex
              ? bold(`[${panel.label}]`, color)
              : dim(panel.label, color)}
          </Text>
        ))}
      </Box>
      {activePanel?.body}
    </Box>
  );
}
