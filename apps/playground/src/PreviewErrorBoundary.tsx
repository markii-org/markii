import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface PreviewErrorBoundaryProps {
  children: ReactNode;
  /**
   * Changing this value (the playground passes the debounced source text)
   * clears a caught error and re-tries rendering `children` — otherwise a
   * one-time crash would keep showing the error message forever, even after
   * the author fixes the document that caused it.
   */
  resetKey: unknown;
}

interface PreviewErrorBoundaryState {
  error: Error | null;
}

/**
 * Belt-and-suspenders around `renderMark`: that function already never
 * throws (it catches internally and renders a fallback), but a *registered*
 * component's own render function can still throw once React actually
 * mounts/updates the element tree, which happens outside `renderMark`'s
 * synchronous try/catch. An error boundary is the only mechanism React
 * offers for that case — without one, a throwing component would white-
 * screen the whole playground (editor included) instead of just the
 * preview pane.
 */
export class PreviewErrorBoundary extends Component<
  PreviewErrorBoundaryProps,
  PreviewErrorBoundaryState
> {
  state: PreviewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): PreviewErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      'Playground preview failed to render:',
      error,
      info.componentStack,
    );
  }

  componentDidUpdate(prevProps: PreviewErrorBoundaryProps): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <div className="playground__preview-error" role="alert">
          <p className="playground__preview-error-label">
            The preview crashed while rendering this document.
          </p>
          <pre className="playground__preview-error-message">
            {error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
