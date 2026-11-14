import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { Box, Text, measureElement, useInput } from 'ink';
import type { DOMElement } from 'ink';
import { dim } from './ansi.js';
import type { AnsiTheme } from './theme.js';
import type { ColorLevel } from './ansi.js';
import { style } from './style.js';
import { cutToWidth } from './text-grid.js';

/**
 * The interactive-mode focus manager: a
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
   * Lets a `tabs` instance tell `InteractiveRoot` which panel is showing,
   * so the status line can name it. Called from an effect in `tabs.tsx`
   * keyed on the active label (so it also follows a re-parse that changes
   * the panels), never during render. The root ignores a report that
   * repeats the label it holds, so the effect cannot loop.
   */
  reportActiveLabel(focusId: number, label: string): void;
  /**
   * Hands a focusable component's outermost `Box` to the root, so the
   * viewport can measure where it sits and scroll it into view. Called from
   * a ref callback (commit time), never during render. `undefined` detaches.
   */
  registerAnchor(focusId: number, node: DOMElement | undefined): void;
}

const FocusContext = createContext<FocusApi>({
  interactive: false,
  focusedId: undefined,
  focusMarker: (text) => text,
  reportActiveLabel: () => {},
  registerAnchor: () => {},
});

/**
 * The `focusId` of the pack component a subtree belongs to, or `undefined`
 * outside one. Provided by `PackFocusScope`; read only by `usePackInput`.
 */
const PackFocusContext = createContext<number | undefined>(undefined);

/**
 * Wraps a focusable pack component's live element. It draws a two-column
 * gutter (the accent marker while the component has focus, blanks
 * otherwise) and names the component's focus id for `usePackInput`. The
 * pack draws inside the width that is left.
 */
export function PackFocusScope({
  focusId,
  children,
}: {
  focusId: number;
  children: ReactNode;
}): ReactNode {
  const gutter = useFocusMarker('▌ ', focusId);
  const focused = useIsFocused(focusId);
  return (
    <PackFocusContext.Provider value={focusId}>
      <Box flexDirection="row">
        <Text>{focused ? gutter : '  '}</Text>
        <Box flexDirection="column" flexGrow={1}>
          {children}
        </Box>
      </Box>
    </PackFocusContext.Provider>
  );
}

/**
 * Ink's `useInput`, for a terminal pack: the same handler and options, but
 * keys reach the handler only while the pack component whose subtree calls
 * it has focus. Outside a focusable pack component it never fires. A pack
 * reads this as `__markiiInk.useInput`, so it never sees raw stdin.
 */
export function usePackInput(
  handler: Parameters<typeof useInput>[0],
  options: Parameters<typeof useInput>[1] = {},
): void {
  const focusId = useContext(PackFocusContext);
  const focused = useIsFocused(focusId);
  useInput(handler, {
    ...options,
    isActive: focused && options.isActive !== false,
  });
}

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
 * `InteractiveRoot`, so the status line names the panel showing rather than
 * the block's first one. Call it from an effect, never during render (see
 * `FocusApi.reportActiveLabel`).
 */
export function useReportActiveLabel(): (
  focusId: number,
  label: string,
) => void {
  const api = useContext(FocusContext);
  return api.reportActiveLabel;
}

/**
 * The ref callback a focusable component puts on its outermost `Box`, so
 * the live viewer can scroll the focused block into view. A no-op without a
 * `focusId` or outside an interactive render.
 */
export function useFocusAnchor(
  focusId: number | undefined,
): (node: DOMElement | null) => void {
  const { registerAnchor } = useContext(FocusContext);
  return useCallback(
    (node: DOMElement | null) => {
      if (focusId === undefined) return;
      registerAnchor(focusId, node ?? undefined);
    },
    [focusId, registerAnchor],
  );
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
  kind: 'tabs' | 'details' | 'pack';
  label: string;
}

export interface InteractiveRootProps {
  /** Every focusable component the walk assigned a `focusId` to, in `focusId` order (empty for none). */
  focusables: readonly FocusableDescriptor[];
  /** Called when the reader presses `q`. The engine owns no process state: it never calls `process.exit` itself. */
  onExit?: () => void;
  /**
   * Called when the reader presses `r`. The host runs whatever it runs and
   * returns when it is done; the engine owns no run, process, or script
   * state. While the returned promise is pending the status line reads
   * "running" and further `r` presses are ignored. A rejection ends the
   * wait like a resolution. Absent, `r` does nothing and the legend omits it.
   */
  onRerun?: () => void | Promise<void>;
  /** The legend to show instead of `keyLegend` when `onRerun` is given: the render's `GlyphSet.keyLegendRerun`. */
  rerunLegend?: string;
  color: ColorLevel;
  theme: AnsiTheme;
  /** The key legend on the status line, identical regardless of what is focused: the render's `GlyphSet.keyLegend`, so it follows the box style. */
  keyLegend: string;
  /**
   * The terminal's row count. When given, the document gets a viewport of
   * this many rows minus the one-row status line, scrolled with the keys in
   * the legend, and the status line stays pinned at the bottom. Absent, the
   * document is laid out at its full height with the status line after it.
   */
  viewportRows?: number;
  /** The columns the status line is cut to, so it stays one row. */
  width: number;
  children: ReactNode;
}

/**
 * The root of an interactive render: owns which `focusId` is focused, moves
 * it on up/down/j/k, calls `onExit` on `q`, and renders the one-line status
 * bar naming the focused block and the key legend. Rendered
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
  onRerun,
  rerunLegend,
  color,
  theme,
  keyLegend,
  viewportRows,
  width,
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

  const viewport =
    viewportRows !== undefined ? Math.max(1, viewportRows - 1) : undefined;
  const [offset, setOffset] = useState(0);
  const contentRef = useRef<DOMElement | null>(null);
  const anchors = useRef(new Map<number, DOMElement>());
  // What the last reveal pass saw, so a reveal runs when focus MOVES or the
  // focused block changes height (a details opening), and not on every
  // render: a reader who scrolled away on purpose is left where they are.
  const lastRevealed = useRef<{ id: number | undefined; height: number }>({
    id: undefined,
    height: -1,
  });

  const contentHeight = (): number =>
    contentRef.current ? measureElement(contentRef.current).height : 0;
  const maxOffset = (): number =>
    viewport === undefined ? 0 : Math.max(0, contentHeight() - viewport);
  const scrollBy = (delta: number): void => {
    if (viewport === undefined) return;
    const limit = maxOffset();
    setOffset((current) => Math.min(limit, Math.max(0, current + delta)));
  };
  const scrollTo = (target: 'top' | 'end'): void => {
    if (viewport === undefined) return;
    setOffset(target === 'top' ? 0 : maxOffset());
  };

  const [running, setRunning] = useState(false);
  // A ref, not the state: two presses in one tick must start one run.
  const runningRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const startRerun = (): void => {
    if (onRerun === undefined || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    const finish = (): void => {
      runningRef.current = false;
      if (mounted.current) setRunning(false);
    };
    try {
      Promise.resolve(onRerun()).then(finish, finish);
    } catch {
      finish();
    }
  };

  useInput(
    (input, key) => {
      if (input === 'q') {
        onExit?.();
        return;
      }
      if (input === 'r') {
        startRerun();
        return;
      }
      if (viewport !== undefined) {
        const page = Math.max(1, viewport - 1);
        if (key.pageDown || input === ' ' || (key.ctrl && input === 'f')) {
          scrollBy(page);
          return;
        }
        if (key.pageUp || input === 'b' || (key.ctrl && input === 'b')) {
          scrollBy(-page);
          return;
        }
        if (key.home || input === 'g') {
          scrollTo('top');
          return;
        }
        if (key.end || input === 'G') {
          scrollTo('end');
          return;
        }
        if (key.ctrl && input === 'e') {
          scrollBy(1);
          return;
        }
        if (key.ctrl && input === 'y') {
          scrollBy(-1);
          return;
        }
      }
      const down = key.downArrow || input === 'j';
      const up = key.upArrow || input === 'k';
      if (focusableCount === 0) {
        // Nothing to focus: the same keys scroll a line at a time.
        if (down) scrollBy(1);
        else if (up) scrollBy(-1);
        return;
      }
      if (down) {
        setFocusIndex((current) => (current + 1) % focusableCount);
      } else if (up) {
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

  const registerAnchor = useCallback(
    (focusId: number, node: DOMElement | undefined) => {
      if (node) anchors.current.set(focusId, node);
      else anchors.current.delete(focusId);
    },
    [],
  );

  const api = useMemo<FocusApi>(
    () => ({
      interactive: true,
      focusedId,
      focusMarker: (text: string) => style(text, '--mk-accent', theme, color),
      reportActiveLabel,
      registerAnchor,
    }),
    [focusedId, color, theme, reportActiveLabel, registerAnchor],
  );

  // After every commit Ink has laid the tree out, so this is where the
  // viewport is kept honest: the offset never exceeds the document (a
  // resize or a closing details can shrink it), and a focus move, or a
  // focused block growing, scrolls that block into view.
  useEffect(() => {
    if (viewport === undefined || !contentRef.current) return;
    const content = measureElement(contentRef.current);
    const limit = Math.max(0, content.height - viewport);
    let next = Math.min(offset, limit);
    const anchor =
      focusedId !== undefined ? anchors.current.get(focusedId) : undefined;
    if (anchor) {
      const box = measureElement(anchor);
      const seen = lastRevealed.current;
      if (seen.id !== focusedId || seen.height !== box.height) {
        lastRevealed.current = { id: focusedId, height: box.height };
        const top = box.y - content.y;
        const bottom = top + box.height;
        if (top < next) next = top;
        else if (bottom > next + viewport)
          next = Math.min(top, bottom - viewport);
        next = Math.min(limit, Math.max(0, next));
      }
    }
    if (next !== offset) setOffset(next);
  });

  const focused = focusedId !== undefined ? focusables[focusedId] : undefined;
  const focusedLabel =
    focused && focusedId !== undefined
      ? (activeLabels[focusedId] ?? focused.label)
      : undefined;
  const statusLabel = running
    ? 'running'
    : focused
      ? `${focused.kind} "${focusedLabel}"`
      : 'nothing focusable';
  const legend =
    onRerun !== undefined && rerunLegend !== undefined
      ? rerunLegend
      : keyLegend;
  // Cut to the width on plain text: the status line must stay one row (the
  // viewport math counts it as one), and a label or legend that wrapped
  // would push the document up.
  const statusLine = dim(cutToWidth(`${statusLabel}  ${legend}`, width), color);

  const status = <Text>{statusLine}</Text>;

  if (viewport === undefined) {
    return (
      <FocusContext.Provider value={api}>
        <Box flexDirection="column">
          {children}
          {status}
        </Box>
      </FocusContext.Provider>
    );
  }

  return (
    <FocusContext.Provider value={api}>
      <Box flexDirection="column" height={viewport + 1}>
        <Box
          flexDirection="column"
          height={viewport}
          flexShrink={0}
          overflow="hidden"
        >
          <Box
            ref={contentRef}
            flexDirection="column"
            flexShrink={0}
            marginTop={-offset}
          >
            {children}
          </Box>
        </Box>
        {status}
      </Box>
    </FocusContext.Provider>
  );
}
