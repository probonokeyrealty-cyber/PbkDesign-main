import {
  ArrowLeft,
  BadgeDollarSign,
  Edit3,
  FileSignature,
  MessageSquare,
  Phone,
  RefreshCw,
  StickyNote,
} from 'lucide-react';
import type { LeadPortalModel } from './leadPortalModel';

type LeadPortalHeaderProps = {
  lead: LeadPortalModel;
  loading: boolean;
  pendingAction: string;
  messageAvailable: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onEdit: () => void;
  onMessage: () => void;
  onCall: () => void;
  onNote: () => void;
  onContract: () => void;
  onAnalyze: () => void;
};

export function LeadPortalHeader({
  lead,
  loading,
  pendingAction,
  messageAvailable,
  onBack,
  onRefresh,
  onEdit,
  onMessage,
  onCall,
  onNote,
  onContract,
  onAnalyze,
}: LeadPortalHeaderProps) {
  return (
    <header className="pbk-lead-portal-header">
      <div className="pbk-lead-portal-heading">
        <button type="button" className="back" onClick={onBack}>
          <ArrowLeft size={16} />
          Leads
        </button>
        <div className="pbk-lead-portal-identity">
          <span className="avatar" aria-hidden="true">
            {lead.initials}
          </span>
          <div>
            <span className="pbk-kicker">Seller workspace</span>
            <h1>{lead.name}</h1>
            <p>{lead.address || 'Property address not captured'}</p>
          </div>
        </div>
        <div className="pbk-lead-portal-status">
          <span>{lead.stage.replace(/[_-]+/g, ' ')}</span>
          <span>{lead.pathLabel}</span>
          {lead.score !== null && <strong>{Math.round(lead.score)} score</strong>}
        </div>
      </div>

      <div className="pbk-lead-portal-actions" aria-label="Lead actions">
        <button type="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
        <button type="button" onClick={onEdit}>
          <Edit3 size={16} />
          Edit
        </button>
        <button
          type="button"
          onClick={onMessage}
          disabled={!messageAvailable}
          title={
            messageAvailable
              ? 'Open the canonical seller conversation'
              : 'No canonical conversation thread exists yet'
          }
        >
          <MessageSquare size={16} />
          Message
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
        <button type="button" className="primary" onClick={onAnalyze}>
          <BadgeDollarSign size={16} />
          Analyze
        </button>
      </div>
    </header>
  );
}
