import { useMemo } from 'react';
import {
  ArrowLeft,
  BadgeDollarSign,
  Bot,
  Edit3,
  ExternalLink,
  FileSignature,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  StickyNote,
  Trash2,
} from 'lucide-react';
import type { LeadPortalModel } from './leadPortalModel';
import { freshAnalyzerHref } from '../../utils/analyzerStorage';

type LeadPortalHeaderProps = {
  lead: LeadPortalModel;
  loading: boolean;
  pendingAction: string;
  messageAvailable: boolean;
  onBack: () => void;
  backLabel?: string;
  onRefresh: () => void;
  onEdit: () => void;
  onAddPhone?: () => void;
  onMessage: () => void;
  onCall: () => void;
  onNote: () => void;
  onContract: () => void;
  onOpenAnalyzer: () => void;
  analyzerAvailable: boolean;
  analyzerReturnHash: string;
  onInspectAgent?: () => void;
  inspectAgentAvailable?: boolean;
  onDelete: () => void;
};

export function LeadPortalHeader({
  lead,
  loading,
  pendingAction,
  messageAvailable,
  onBack,
  backLabel = 'Leads',
  onRefresh,
  onEdit,
  onAddPhone,
  onMessage,
  onCall,
  onNote,
  onContract,
  onOpenAnalyzer,
  analyzerAvailable,
  analyzerReturnHash,
  onInspectAgent,
  inspectAgentAvailable = true,
  onDelete,
}: LeadPortalHeaderProps) {
  const hasCallablePhone = lead.phone.replace(/\D/g, '').length >= 10;
  const freshHref = useMemo(() => freshAnalyzerHref(lead.id), [lead.id]);

  return (
    <header className="pbk-lead-portal-header">
      <div className="pbk-lead-portal-heading">
        <button
          type="button"
          className="back"
          aria-label={`Back to ${backLabel.toLowerCase()}`}
          onClick={onBack}
        >
          <ArrowLeft size={16} />
          {backLabel}
        </button>
        <div className="pbk-lead-portal-identity">
          <span className="avatar" aria-hidden="true">
            {lead.initials}
          </span>
          <div>
            <span className="pbk-kicker">Seller workspace</span>
            <h1>{lead.name}</h1>
            <p>{lead.address || 'Property address not captured'}</p>
            <p className="pbk-portal-contact-summary">
              {[lead.phone || lead.email, lead.assignedAgent].filter(Boolean).join(' / ')}
            </p>
          </div>
        </div>
        <div className="pbk-lead-portal-status">
          <span>{lead.stage.replace(/[_-]+/g, ' ')}</span>
          <span>{lead.pathLabel}</span>
          {lead.score !== null && <strong>{Math.round(lead.score)} score</strong>}
        </div>
      </div>

      <div className="pbk-lead-portal-actions" aria-label="Lead actions">
        <button type="button" className="primary" onClick={onOpenAnalyzer} disabled={loading || !analyzerAvailable}>
          <BadgeDollarSign size={16} />
          Open Analyzer
        </button>
        {!loading && analyzerAvailable && (
          <a className="pbk-fresh-analyzer" href={freshHref + analyzerReturnHash} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} aria-hidden="true" />
            Open in fresh Analyzer
          </a>
        )}
        {onInspectAgent && (
          <button
            type="button"
            onClick={onInspectAgent}
            disabled={loading || !inspectAgentAvailable}
            data-inspect-agent
          >
            <Bot size={16} aria-hidden="true" /> Inspect agent
          </button>
        )}
        <button type="button" onClick={onEdit}>
          <Edit3 size={16} />
          Edit lead
        </button>
        {!hasCallablePhone && (
          <button type="button" className="primary" onClick={onAddPhone || onEdit}>
            <Plus size={16} />
            Add phone
          </button>
        )}
        <button
          type="button"
          onClick={onMessage}
          disabled={!messageAvailable}
          title={
            messageAvailable
              ? 'Open this seller\'s conversation'
              : 'No saved conversation for this seller yet'
          }
        >
          <MessageSquare size={16} />
          Open conversation
        </button>
        <button type="button" onClick={onCall} disabled={Boolean(pendingAction)}>
          <Phone size={16} />
          Call
        </button>
        <button type="button" onClick={onNote}>
          <StickyNote size={16} />
          Note
        </button>
        <button type="button" onClick={onContract} disabled={Boolean(pendingAction)}>
          <FileSignature size={16} />
          Contract
        </button>
        <button type="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh lead
        </button>
        <button
          type="button"
          className="danger"
          onClick={onDelete}
          disabled={Boolean(pendingAction)}
        >
          <Trash2 size={16} />
          Delete lead
        </button>
      </div>
    </header>
  );
}
