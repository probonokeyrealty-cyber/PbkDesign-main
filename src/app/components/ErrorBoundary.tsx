import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isStaleDynamicImportError, reloadForCurrentDeploy } from '../utils/deployVersion';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
  recoveringFromChunk: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, recoveringFromChunk: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, recoveringFromChunk: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PBK] Unhandled React error:', error, info.componentStack);
    if (isStaleDynamicImportError(error) && reloadForCurrentDeploy('react-boundary-chunk-error')) {
      this.setState({ recoveringFromChunk: true });
    }
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      const staleChunk = isStaleDynamicImportError(this.state.error);
      const title = this.state.recoveringFromChunk
        ? 'Loading the latest Command Center...'
        : staleChunk
          ? 'This panel needs the latest app version.'
          : 'Something went wrong in this panel.';
      const message = this.state.recoveringFromChunk
        ? 'A deploy finished while this page was open. Refreshing once so the panel can load the current files.'
        : staleChunk
          ? 'The page was pointing at an older app file after a deploy. Reload the page to pick up the current Command Center.'
          : this.state.error.message;
      return (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-2xl border border-red-800/40 bg-red-950/20 p-8 text-center">
          <div className="text-sm font-semibold text-red-300">{title}</div>
          <div className="max-w-sm text-xs text-red-400/80">{message}</div>
          <button
            type="button"
            onClick={() => {
              if (staleChunk && typeof window !== 'undefined') {
                window.location.reload();
                return;
              }
              this.setState({ error: null, recoveringFromChunk: false });
            }}
            className="rounded-full border border-red-700/50 px-4 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-900/30"
          >
            {staleChunk ? 'Reload page' : 'Try again'}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
