import App from '../App';

/**
 * DealView — THE SEAM between Paradise shell and the PBK engine.
 *
 * Mounts the existing `<App />` engine (TopBar + LeftPanel + RightPanel +
 * AnalyzerTab + CallModeTab + PathDeliverables + CRMFeatures + locked
 * dealCalculations) inside the Paradise layout's content area.
 *
 * NOTHING IN THE ENGINE IS MODIFIED. The engine renders its own internal
 * chrome (its TopBar etc.) — we accept the visual double-topbar in this
 * skeleton; step (c) introduces an "engine-only" prop on App to suppress
 * its internal TopBar when mounted inside the shell.
 *
 * This is the wrap-don't-replace seam from PBK_COMPONENT_ARCHITECTURE.md.
 */
export function DealView() {
  return (
    <div className="h-full">
      <App />
    </div>
  );
}
