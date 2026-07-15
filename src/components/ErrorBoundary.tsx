import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** When any value here changes, a shown error is cleared and the subtree re-renders. */
  resetKeys?: unknown[];
}

interface State {
  error: Error | null;
}

/** True when two `resetKeys` arrays are element-wise equal (or both absent). */
function sameKeys(a?: unknown[], b?: unknown[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => Object.is(v, b[i]));
}

/**
 * Catches render-time exceptions from its subtree so one failing view can't blank the whole app.
 * Renders a fallback with a "Try again" button, and auto-resets when `resetKeys` change (e.g. the
 * user switches tab or region). React 19 error boundaries are still class-based — there is no hook
 * equivalent. Note: boundaries do not catch errors thrown in event handlers or async callbacks.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("View crashed:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && !sameKeys(prev.resetKeys, this.props.resetKeys)) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Something went wrong</h2>
        <p className="muted">{error.message || "This view hit an unexpected error."}</p>
        <button onClick={this.reset}>Try again</button>
      </section>
    );
  }
}
