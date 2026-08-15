import type { ReactElement, ReactNode } from 'react';

export interface UnknownDirectiveProps {
  name: string;
  inline?: boolean;
  children?: ReactNode;
}

/**
 * Fallback for an unregistered directive name. Never throws; renders a
 * neutral dashed-border box (or an inline span, for text directives) with a
 * label naming the missing component, and still shows the directive's inner
 * content (already rendered as plain markdown by the pipeline). This is
 * what keeps `.mk.md` tolerant like markdown instead of brittle like code.
 */
export function UnknownDirective({
  name,
  inline = false,
  children,
}: UnknownDirectiveProps): ReactElement {
  if (inline) {
    return (
      <span className="mk-unknown mk-unknown--inline">
        <span className="mk-unknown__label">
          unknown component <code>{name}</code>
        </span>
        {children}
      </span>
    );
  }

  return (
    <div className="mk-unknown mk-unknown--block">
      <p className="mk-unknown__label">
        unknown component <code>{name}</code>
      </p>
      {children ? <div className="mk-unknown__content">{children}</div> : null}
    </div>
  );
}
