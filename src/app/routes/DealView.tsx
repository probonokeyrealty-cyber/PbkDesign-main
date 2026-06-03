import { Component, type ReactNode } from 'react';
import App from '../App';

type DealViewErrorBoundaryState = {
  error: Error | null;
};

class DealViewErrorBoundary extends Component<{ children: ReactNode }, DealViewErrorBoundaryState> {
  state: DealViewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): DealViewErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[PBK DealView] engine render failed', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid h-full place-items-center bg-slate-950 p-6 text-slate-100">
          <div className="max-w-md rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
            <div className="text-[11px] uppercase tracking-[0.16em] text-amber-300">
              Deal engine unavailable
            </div>
            <h2 className="mt-2 text-lg font-semibold">The analyzer failed to render.</h2>
            <p className="mt-2 text-sm text-slate-300">
              The shell is still running. Reload the Deal route after fixing the engine error.
            </p>
            <pre className="mt-3 max-h-28 overflow-auto rounded-xl bg-slate-950/70 p-3 text-xs text-amber-100">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              className="mt-4 rounded-full bg-sky-400 px-4 py-2 text-sm font-bold text-slate-950"
              onClick={() => this.setState({ error: null })}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function DealView() {
  return (
    <div className="h-full min-h-[680px]">
      <DealViewErrorBoundary>
        <App engineOnly />
      </DealViewErrorBoundary>
    </div>
  );
}
