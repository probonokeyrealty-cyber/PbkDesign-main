import { useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  FileText,
  PanelLeft,
  PhoneCall,
  Save,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
  Workflow,
} from 'lucide-react';
import { PbkDataSource } from '../../components/pbk/index';
import { DealData, PBKPath } from '../types';
import { formatCurrency } from '../utils/formatting';
import { getPathLabel } from '../utils/pbk';

export type AnalyzerTabId = 'analyzer' | 'callmode' | 'documents' | 'crm';

type DealAnalyzerChromeProps = {
  deal: DealData;
  selectedPath: PBKPath;
  activeTab: AnalyzerTabId;
  analyzeStatus: string;
  onTabChange: (tab: AnalyzerTabId) => void;
  onOpenSnapshot: () => void;
  onOpenWorkflow: () => void;
  onAnalyze: () => void | Promise<void>;
  onSaveDeal: () => void | Promise<void>;
  onOpenDocuments: () => void;
  onCreateLead: () => void;
};

const TAB_ITEMS: Array<{ id: AnalyzerTabId; label: string }> = [
  { id: 'analyzer', label: 'Analyzer' },
  { id: 'callmode', label: 'Call Mode' },
  { id: 'documents', label: 'Documents' },
  { id: 'crm', label: 'CRM' },
];

function getVerdictMeta(verdict: DealData['verdict']) {
  if (verdict === 'green') return { label: 'Go', className: 'is-go' };
  if (verdict === 'yellow') return { label: 'Review', className: 'is-review' };
  if (verdict === 'red') return { label: 'Pass', className: 'is-pass' };
  return { label: 'Not analyzed', className: 'is-idle' };
}

function getShortAddress(address = '') {
  const trimmed = address.trim();
  if (!trimmed) return 'No property loaded';
  return trimmed.length > 54 ? `${trimmed.slice(0, 51)}...` : trimmed;
}

function valueOrZero(value?: number | null) {
  return Number.isFinite(value as number) ? Number(value) : 0;
}

function getPathControlMetric(deal: DealData, selectedPath: PBKPath) {
  const agreedPrice = valueOrZero(deal.agreedPrice) || valueOrZero(deal.price);

  if (selectedPath === 'cash') {
    return {
      label: 'MAO Cash',
      value: valueOrZero(deal.mao60),
    };
  }

  if (selectedPath === 'rbp') {
    return {
      label: 'MAO RBP',
      value: valueOrZero(deal.rbpPriceConfirm) || valueOrZero(deal.maoRBP),
    };
  }

  if (selectedPath === 'cf') {
    return {
      label: 'CF Control',
      value: agreedPrice || valueOrZero(deal.maoRBP),
    };
  }

  if (selectedPath === 'mt') {
    return {
      label: 'MT Control',
      value: valueOrZero(deal.mtUpfront) || agreedPrice || valueOrZero(deal.maoRBP),
    };
  }

  if (selectedPath === 'rbp-land') {
    return {
      label: 'Land RBP',
      value: valueOrZero(deal.builderTotal) || valueOrZero(deal.maoRBP),
    };
  }

  return {
    label: 'Land Offer',
    value: valueOrZero(deal.offer) || valueOrZero(deal.mao60),
  };
}

export function DealAnalyzerCommandHeader({
  deal,
  selectedPath,
  activeTab,
  analyzeStatus,
  onTabChange,
  onOpenSnapshot,
  onOpenWorkflow,
  onAnalyze,
  onSaveDeal,
  onOpenDocuments,
  onCreateLead,
}: DealAnalyzerChromeProps) {
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const verdictMeta = getVerdictMeta(deal.verdict);
  const pathLabel = getPathLabel(selectedPath);
  const pathControl = getPathControlMetric(deal, selectedPath);

  const handleTabChange = (tab: AnalyzerTabId) => {
    onTabChange(tab);
    setMobileControlsOpen(false);
  };

  return (
    <header className="pbk-analyzer-command">
      <div className="pbk-analyzer-command-main">
        <div className="pbk-analyzer-title-block">
          <span className="pbk-kicker">Deal Analyzer</span>
          <h1>{getShortAddress(deal.address)}</h1>
          <p>
            Operator-first underwriting, path selection, call prep, and seller package controls stay
            in one live engine.
          </p>
        </div>

        <div className="pbk-analyzer-command-actions">
          <button
            type="button"
            className="pbk-btn pbk-btn-ghost pbk-btn-sm"
            onClick={onOpenSnapshot}
          >
            <PanelLeft size={14} />
            Snapshot
          </button>
          <button
            type="button"
            className="pbk-btn pbk-btn-ghost pbk-btn-sm"
            onClick={onOpenWorkflow}
          >
            <Workflow size={14} />
            Workflow
          </button>
          <button
            type="button"
            className="pbk-btn pbk-btn-ghost pbk-btn-sm"
            onClick={onOpenDocuments}
          >
            <FileText size={14} />
            Docs
          </button>
          <button type="button" className="pbk-btn pbk-btn-primary pbk-btn-sm" onClick={onSaveDeal}>
            <Save size={14} />
            Save
          </button>
          <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={onCreateLead}>
            <UserPlus size={14} />
            Lead
          </button>
          <button type="button" className="pbk-btn pbk-btn-success pbk-btn-sm" onClick={onAnalyze}>
            <Sparkles size={14} />
            Analyze
          </button>
        </div>
      </div>

      <div className="pbk-analyzer-ribbon">
        <div className="pbk-analyzer-metric">
          <span>Path</span>
          <strong>{pathLabel}</strong>
        </div>
        <div className="pbk-analyzer-metric">
          <span>ARV</span>
          <strong>{formatCurrency(deal.arv)}</strong>
        </div>
        <div className="pbk-analyzer-metric">
          <span>{pathControl.label}</span>
          <strong>{formatCurrency(pathControl.value)}</strong>
        </div>
        <div className={`pbk-analyzer-verdict ${verdictMeta.className}`}>
          <span>Verdict</span>
          <strong>{verdictMeta.label}</strong>
        </div>
        <PbkDataSource
          endpoint="window.PBKAnalyzer + POST /api/analyzeDeal"
          status="ships"
          note={analyzeStatus ? 'last analyzer status shown in engine' : 'local state bridge'}
        />
      </div>

      <button
        type="button"
        className="pbk-analyzer-mobile-toggle"
        aria-expanded={mobileControlsOpen}
        aria-controls="pbk-analyzer-mobile-controls"
        onClick={() => setMobileControlsOpen((open) => !open)}
      >
        <span className="toggle-icon" aria-hidden="true">
          <SlidersHorizontal size={15} />
        </span>
        <span className="toggle-copy">
          <span>Controls</span>
          <strong>
            {TAB_ITEMS.find((tab) => tab.id === activeTab)?.label || 'Analyzer'} / {pathLabel}
          </strong>
        </span>
        <ChevronDown size={16} className="toggle-chevron" aria-hidden="true" />
      </button>

      <div
        id="pbk-analyzer-mobile-controls"
        className="pbk-analyzer-tab-shell"
        data-open={mobileControlsOpen ? 'true' : 'false'}
      >
        <nav className="pbk-analyzer-tabs" aria-label="Deal analyzer sections">
          {TAB_ITEMS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-label={`Switch analyzer tab to ${tab.label}`}
              aria-pressed={activeTab === tab.id}
              data-active={activeTab === tab.id}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="pbk-analyzer-mobile-quick-actions">
          <button
            type="button"
            className="pbk-btn pbk-btn-ghost pbk-btn-sm"
            onClick={onOpenWorkflow}
          >
            <Workflow size={14} />
            Workflow
          </button>
          <button
            type="button"
            className="pbk-btn pbk-btn-ghost pbk-btn-sm"
            onClick={onOpenDocuments}
          >
            <FileText size={14} />
            Docs
          </button>
          <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={onCreateLead}>
            <UserPlus size={14} />
            Create Lead
          </button>
          <button type="button" className="pbk-btn pbk-btn-success pbk-btn-sm" onClick={onAnalyze}>
            <Sparkles size={14} />
            Analyze
          </button>
        </div>
      </div>
    </header>
  );
}

export function DealAnalyzerMobileRail({
  deal,
  selectedPath,
  onOpenSnapshot,
  onOpenWorkflow,
  onAnalyze,
  onTabChange,
}: Pick<
  DealAnalyzerChromeProps,
  'deal' | 'selectedPath' | 'onOpenSnapshot' | 'onOpenWorkflow' | 'onAnalyze' | 'onTabChange'
>) {
  return (
    <div className="pbk-analyzer-mobile-rail" aria-label="Deal analyzer mobile actions">
      <button type="button" aria-label="Open analyzer snapshot" onClick={onOpenSnapshot}>
        <PanelLeft size={16} />
        <span>Snapshot</span>
      </button>
      <button type="button" aria-label="Analyze deal" className="is-primary" onClick={onAnalyze}>
        <BarChart3 size={16} />
        <span>{deal.isAnalyzed ? 'Refresh' : 'Analyze'}</span>
      </button>
      <button type="button" aria-label="Open Call Mode" onClick={() => onTabChange('callmode')}>
        <PhoneCall size={16} />
        <span>Call</span>
      </button>
      <button type="button" aria-label="Open analyzer workflow" onClick={onOpenWorkflow}>
        <Workflow size={16} />
        <span>{getPathLabel(selectedPath)}</span>
      </button>
    </div>
  );
}
