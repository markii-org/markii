import type { ReactElement } from 'react';

export interface ScriptMarkerProps {
  /** The script's `name` attribute (`{name=stars}`) — always non-empty; callers only render this component once a name has been confirmed present. */
  name: string;
  /** The fence's language tag (`lua` for ` ```lua {name=...}` `), or `''` if the fence had none. */
  lang: string;
  /** The `src=` bundle-relative long-script path (docs/scripting.md), if present — the fence is then a one-line reference with an empty body. */
  src?: string;
  /** The fence's own body text, exactly as authored (empty for a `src=` reference). */
  code: string;
  /** Whether the meta group carried a bare `open` attribute — renders the `<details>` expanded by default instead of folded. */
  open?: boolean;
}

/**
 * Collapsed, expandable marker for a script code block (docs/scripting.md: a
 * fenced code block whose meta carries a `{name=...}` attribute group).
 * Renders a native `<details>` — folded by default, works with zero JS —
 * whose `<summary>` is a compact `⚙ name` marker (plus language, or the
 * `src=` path when the block is a long-script reference) and whose body is
 * the fence's own text, byte-for-byte, inside an ordinary `<pre><code>`
 * (never reformatted or re-highlighted). A `src=` reference has an empty
 * body — that's shown as a small note instead of a confusing empty `<pre>`.
 */
export function ScriptMarker({
  name,
  lang,
  src,
  code,
  open = false,
}: ScriptMarkerProps): ReactElement {
  const detail = src ?? lang;
  const summary = detail ? `⚙ ${name} · ${detail}` : `⚙ ${name}`;

  return (
    <details className="mk-script" open={open}>
      <summary className="mk-script__summary">{summary}</summary>
      {code ? (
        <pre className="mk-script__code">
          <code>{code}</code>
        </pre>
      ) : (
        <p className="mk-script__empty">
          {src ? `source: ${src}` : 'no inline body'}
        </p>
      )}
    </details>
  );
}
