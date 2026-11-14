import { Mail, MessageSquareText, Phone, ShieldCheck } from 'lucide-react';
import type { LeadPortalModel } from './leadPortalModel';
import { formatLeadValue } from './leadPortalModel';

export function LeadPortalContactability({ lead }: { lead: LeadPortalModel }) {
  const dnc = lead.dncStatus.trim().toLowerCase().replace(/[_-]+/g, ' ');
  const blocked = ['blocked', 'dnc', 'do not call', 'do not contact'].includes(dnc);
  const clear = dnc === 'clear';
  const consent = lead.tcpaConsent.trim().toLowerCase();
  const consented = consent === 'yes';
  const summary = blocked ? 'Contact blocked' : consented && clear ? 'Records on file' : 'Contact records need review';

  return (
    <section className="pbk-lead-portal-card" aria-label="Contactability">
      <header>
        <div>
          <span className="pbk-kicker">Reachability &amp; safety</span>
          <h2>Contactability</h2>
        </div>
        <ShieldCheck size={19} />
      </header>
      <div className="pbk-contact-record-status" data-blocked={blocked}>
        <strong>{summary}</strong>
        <span>Saved lead records, not an outreach clearance.</span>
      </div>
      <div className="pbk-lead-portal-detail-list">
        <div>
          <Phone />
          <span>Phone</span>
          <strong>{lead.phone || 'Not captured'}</strong>
        </div>
        <div>
          <Mail />
          <span>Email</span>
          <strong>{lead.email || 'Not captured'}</strong>
        </div>
        <div>
          <MessageSquareText />
          <span>Preferred channel</span>
          <strong>{formatLeadValue(lead.preferredChannel)}</strong>
        </div>
        <div>
          <span className="plain-dot" aria-hidden="true" />
          <span>Best time to call</span>
          <strong>{lead.bestTimeToCall || 'Not captured'}</strong>
        </div>
      </div>
      <div className="pbk-lead-portal-compliance">
        <div className={consented ? 'clear' : 'review'}>
          <span>TCPA consent</span>
          <strong>{formatLeadValue(lead.tcpaConsent)}</strong>
        </div>
        <div className={blocked ? 'blocked' : clear ? 'clear' : 'review'}>
          <span>DNC status</span>
          <strong>{formatLeadValue(lead.dncStatus)}</strong>
        </div>
      </div>
    </section>
  );
}
