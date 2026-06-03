import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PBK] Unhandled React error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-2xl border border-red-800/40 bg-red-950/20 p-8 text-center">
          <div className="text-sm font-semibold text-red-300">Something went wrong in this panel.</div>
          <div className="max-w-sm text-xs text-red-400/80">{this.state.error.message}</div>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded-full border border-red-700/50 px-4 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-900/30"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
