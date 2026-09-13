import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';
import { dim } from './ansi.js';
import type { AnsiTheme } from './theme.js';
import type { ColorLevel } from './ansi.js';
import { style } from './style.js';

/**
 * The interactive-mode focus manager (batch 10's live-viewer support): a
 * document-order list of FOCUSABLE components (currently `tabs` and
 * `details`) that up/down/j/k step through, and `q` to quit. Focus itself
 * needs no runtime registration effect: `render.tsx`'s walk already knows
 * the total number of focusable components the moment it finishes building
 * the tree (it assigns each one a stable `focusId` as it goes — see
 * `render.tsx`'s `WalkContext.nextFocusId`), so this context is handed that
 * total up front rather than discovering it via a mount-time side effect.
 *
 * Per-component key handling (tabs' left/right, details' enter) is each
 * component's OWN `useInput` call, scoped with Ink's `isActive` option to
 * only the currently focused instance — see `tabs.tsx`/`details.tsx`. This
 * module owns only the SHARED part: which id is focused, and moving it.
 */

interface FocusApi {
  /** Whether this render is interactive at all; components read `ctx.interactive` directly, but the fallback context (no provider) must default to false too. */
  interactive: boolean;
  /** The currently focused component's `focusId`, or `undefined` when there is nothing focusable. */
  focusedId: number | undefined;
  /** The accent-colored focus ring text a focused component draws around its own heading, styled at the render's resolved color level. */
  focusMarker(text: string): string;
  /**
   * Lets a `tabs` instance tell `InteractiveRoot` which panel is active NOW,
   * so the status line can name it. Called from a KEY HANDLER (`tabs.tsx`'s
   * `useInput` callback) when the reader switches panels, never during
   * render — this is an ordinary React "child calls a parent callback on an
   * event" pattern, not a render-time report channel. The distinction
   * matters: batch 10.1 deliberately avoided a report channel invoked DURING
   * render (that shape can trigger a render loop, since it would call
   * `setState` while React is still computing the current render). A
   * callback invoked from a keypress handler carries no such risk — it runs
   * strictly BETWEEN renders, exactly like any other event handler calling
   * `setState`.
   */
  reportActiveLabel(focusId: number, label: string): void;
}

const FocusContext = createContext<FocusApi>({
  interactive: false,
  focusedId: undefined,
  focusMarker: (text) => text,
  reportActiveLabel: () => {},
});

/** Whether the component identified by `focusId` is the currently focused one. `undefined` (a non-interactive render, or a component that never got a `focusId`) is never focused. */
export function useIsFocused(focusId: number | undefined): boolean {
  const api = useContext(FocusContext);
  return focusId !== undefined && api.interactive && api.focusedId === focusId;
}

/** Wraps `text` in the accent-colored focus marker when interactive AND `focusId` is the focused one; otherwise returns `text` unchanged. */
export function useFocusMarker(
  text: string,
  focusId: number | undefined,
): string {
  const api = useContext(FocusContext);
  const focused =
    focusId !== undefined && api.interactive && api.focusedId === focusId;
  return focused ? api.focusMarker(text) : text;
}

/**
 * Lets a `tabs` instance report its currently active panel's label to
 * `InteractiveRoot`, so the status line can name it. Call this from a KEY
 * HANDLER only (see `FocusApi.reportActiveLabel`'s doc comment for why that
 * is not the render-time report channel batch 10.1 avoided).
 */
export function useReportActiveLabel(): (
  focusId: number,
  label: string,
) => void {
  const api = useContext(FocusContext);
  return api.reportActiveLabel;
}

/**
 * One focusable component, in the same document order `render.tsx`'s
 * counting walk assigns `focusId`s in — `focusables[focusId]` is always
 * that component's descriptor. `label` is the descriptor's STABLE identity
 * (for `tabs`, the FIRST panel's label): it is used on the status line only
 * until a `tabs` instance reports its actual active panel via
 * `reportActiveLabel`, and as the fallback before any report has happened
 * yet (mount, or a reader who has not switched panels).
 */
export interface FocusableDescriptor {
  kind: 'tabs' | 'details';
  label: string;
}

/** The key legend shown on the status line, identical regardless of what is focused. */
const KEY_LEGEND = '↑↓/jk focus  ←→/tab switch  enter open/close  q quit';

export interface InteractiveRootProps {
  /** Every focusable component the walk assigned a `focusId` to, in `focusId` order (empty for none). */
  focusables: readonly FocusableDescriptor[];
  /** Called when the reader presses `q`. The engine owns no process state: it never calls `process.exit` itself (AGENTS.md, batch-10 brief). */
  onExit?: () => void;
  color: ColorLevel;
  theme: AnsiTheme;
  children: ReactNode;
}

/**
 * The root of an interactive render: owns which `focusId` is focused, moves
 * it on up/down/j/k, calls `onExit` on `q`, and renders the one-line status
 * bar (batch 10.1) naming the focused block and the key legend. Rendered
 * only when the caller actually wants a live, keyboard-driven view:
 * `buildMarkElement` mounts this when `interactive` is true, but the
 * render-ONCE string path (`ink-string.ts`, `renderRootToString`) never
 * reaches it at all — `tabs`/`details` still fall back to `FocusContext`'s
 * default (uninteractive) value there, so a string render never sees a
 * focus marker, a glyph, or a status line.
 */
export function InteractiveRoot({
  focusables,
  onExit,
  color,
  theme,
  children,
}: InteractiveRootProps): ReactNode {
  const focusableCount = focusables.length;
  const [focusIndex, setFocusIndex] = useState(0);
  // `focusId -> the label its last active-panel report carried`. Only a
  // `tabs` descriptor is ever reported against; `details` never calls
  // `reportActiveLabel`, so its entry here simply never appears. Absent
  // keys are expected (mount, or a `tabs` the reader has not switched yet)
  // and fall back to the descriptor's own stable `label` below.
  const [activeLabels, setActiveLabels] = useState<Record<number, string>>({});

  useInput(
    (input, key) => {
      if (input === 'q') {
        onExit?.();
        return;
      }
      if (focusableCount === 0) return;
      if (key.downArrow || input === 'j') {
        setFocusIndex((current) => (current + 1) % focusableCount);
      } else if (key.upArrow || input === 'k') {
        setFocusIndex(
          (current) => (current - 1 + focusableCount) % focusableCount,
        );
      }
    },
    { isActive: true },
  );

  const focusedId =
    focusableCount > 0 ? focusIndex % focusableCount : undefined;

  // Invoked from `tabs.tsx`'s KEY HANDLER, never during render — see
  // `FocusApi.reportActiveLabel`'s doc comment. The equality guard avoids an
  // unnecessary re-render when a switch reports the label it already had
  // (e.g. wrapping from the last panel back past the first is still a real
  // change, but re-reporting the same active panel is not).
  const reportActiveLabel = useCallback((focusId: number, label: string) => {
    setActiveLabels((current) =>
      current[focusId] === label ? current : { ...current, [focusId]: label },
    );
  }, []);

  const api = useMemo<FocusApi>(
    () => ({
      interactive: true,
      focusedId,
      focusMarker: (text: string) => style(text, '--mk-accent', theme, color),
      reportActiveLabel,
    }),
    [focusedId, color, theme, reportActiveLabel],
  );

  const focused = focusedId !== undefined ? focusables[focusedId] : undefined;
  const focusedLabel =
    focused && focusedId !== undefined
      ? (activeLabels[focusedId] ?? focused.label)
      : undefined;
  const statusLabel = focused
    ? `${focused.kind} "${focusedLabel}"`
    : 'nothing focusable';
  const statusLine = dim(`${statusLabel}  ${KEY_LEGEND}`, color);

  return (
    <FocusContext.Provider value={api}>
      <Box flexDirection="column">
        {children}
        <Text>{statusLine}</Text>
      </Box>
    </FocusContext.Provider>
  );
}
