import {
  Bot,
  CalendarClock,
  FileSignature,
  MessagesSquare,
  PhoneCall,
  UserRound,
} from 'lucide-react';
import type { LeadPortalModel } from './leadPortalModel';
import { formatLeadValue } from './leadPortalModel';

type LeadPortalOverviewProps = {
  lead: LeadPortalModel;
};

export function LeadPortalOverview({ lead }: LeadPortalOverviewProps) {
  return (
    <section className="pbk-lead-portal-card pbk-lead-portal-overview">
      <header>
        <div>
          <span className="pbk-kicker">Identity &amp; relationship</span>
          <h2>Overview</h2>
        </div>
        <UserRound size={19} />
      </header>
      <div className="pbk-lead-portal-metrics">
        <div>
          <PhoneCall />
          <span>Calls</span>
          <strong>{lead.calls.length}</strong>
        </div>
        <div>
          <MessagesSquare />
          <span>Messages</span>
          <strong>{lead.messages.length}</strong>
        </div>
        <div>
          <FileSignature />
          <span>Documents</span>
          <strong>{lead.contracts.length}</strong>
        </div>
        <div>
          <CalendarClock />
          <span>Analyzer runs</span>
          <strong>{lead.analyzerRuns.length}</strong>
        </div>
      </div>
      <div className="pbk-lead-portal-overview-grid">
        <div>
          <span>Relationship</span>
          <strong>{formatLeadValue(lead.relationship)}</strong>
        </div>
        <div>
          <span>Assigned agent</span>
          <strong>{lead.assignedAgent}</strong>
        </div>
        <div>
          <span>Lead source</span>
          <strong>{lead.source || 'Not captured'}</strong>
        </div>
        <div>
          <span>Current stage</span>
          <strong>{formatLeadValue(lead.stage)}</strong>
        </div>
      </div>
      <div className="pbk-lead-portal-brief">
        <span>
          <Bot size={16} />
          Ava pre-call brief
        </span>
        <p>{lead.avaBrief}</p>
      </div>
      <div className="pbk-lead-portal-notes">
        <div>
          <span>Seller notes</span>
          <p>{lead.sellerNotes || 'No seller-facing notes captured.'}</p>
        </div>
        <div>
          <span>Internal notes</span>
          <p>{lead.internalNotes || 'No underwriting notes captured.'}</p>
        </div>
      </div>
    </section>
  );
}
