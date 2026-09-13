import { useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';
import { bold, dim } from '../ansi.js';
import type { ColorLevel } from '../ansi.js';
import { useFocusMarker, useIsFocused } from '../interactive.js';

/**
 * `:::details{title="..." open} ... :::` — a collapsible disclosure, built
 * as a real Ink element (`render.tsx`'s `renderDetailsElement` calls this
 * directly, the same way it calls `InteractiveTabs` for `tabs` — see
 * `registry.ts`'s and `render.tsx`'s doc comments).
 *
 * Non-interactive (the default, and the render-once path): ALWAYS shows the
 * body, exactly like the pre-Ink engine — a static render has no
 * expand/collapse affordance. The bare `open` attribute only changes the
 * marker glyph (`▾` for `open`, `▸` for folded-by-default), a quiet hint at
 * the note's own authored default.
 *
 * Interactive: starts CLOSED unless `open` was given; Enter toggles it when
 * this `details` instance is focused (`useIsFocused`). When focused, the
 * summary line also carries a dim hint (`enter to open`/`enter to close`,
 * matching the current state) and the whole line is drawn in the accent
 * color with a leading `› ` glyph (`useFocusMarker`), so focus is visible
 * even on a theme with no perceptible accent color; unfocused, the line
 * gets two leading spaces instead, so nothing shifts horizontally when
 * focus moves onto or off of this block.
 */
export interface InteractiveDetailsProps {
  title: string;
  body: ReactNode;
  defaultOpen: boolean;
  color: ColorLevel;
  interactive: boolean;
  focusId: number | undefined;
}

export function InteractiveDetails({
  title,
  body,
  defaultOpen,
  color,
  interactive,
  focusId,
}: InteractiveDetailsProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  const focused = useIsFocused(focusId);

  useInput(
    (_input, key) => {
      if (key.return) setOpen((current) => !current);
    },
    { isActive: interactive && focused },
  );

  // Every hook this component calls runs BEFORE the non-interactive early
  // return below, so the hook order is identical in both modes. The summary
  // line is cheap to build and unused in the non-interactive branch; that
  // waste is the price of never making a hook call conditional.
  const openGlyph = open ? '▾' : '▸';
  const hint = focused ? (open ? '  enter to close' : '  enter to open') : '';
  const summaryLine = dim(`${openGlyph} ${bold(title, color)}${hint}`, color);
  const focusGlyph = focused ? '› ' : '  ';
  const headingLine = useFocusMarker(`${focusGlyph}${summaryLine}`, focusId);

  if (!interactive) {
    const glyph = defaultOpen ? '▾' : '▸';
    return (
      <Box flexDirection="column">
        <Text>
          {dim(
            `${glyph} ${bold(title, color)} (collapsible section, shown expanded)`,
            color,
          )}
        </Text>
        <Box marginLeft={2} flexDirection="column">
          {body}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>{headingLine}</Text>
      {open && (
        <Box marginLeft={2} flexDirection="column">
          {body}
        </Box>
      )}
    </Box>
  );
}
