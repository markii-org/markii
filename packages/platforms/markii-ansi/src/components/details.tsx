import { useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';
import { bold, dim } from '../ansi.js';
import type { ColorLevel } from '../ansi.js';
import { useIsFocused } from '../interactive.js';

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
 * this `details` instance is focused (`useIsFocused`).
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

  const glyph = open ? '▾' : '▸';
  return (
    <Box flexDirection="column">
      <Text>{dim(`${glyph} ${bold(title, color)}`, color)}</Text>
      {open && (
        <Box marginLeft={2} flexDirection="column">
          {body}
        </Box>
      )}
    </Box>
  );
}
