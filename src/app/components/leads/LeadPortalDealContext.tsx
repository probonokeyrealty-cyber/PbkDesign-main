import { BadgeDollarSign, CircleDollarSign, Gauge, Sparkles } from 'lucide-react';
import type { LeadPortalModel } from './leadPortalModel';
import { formatLeadMoney, formatLeadValue } from './leadPortalModel';

export function LeadPortalDealContext({ lead }: { lead: LeadPortalModel }) {
  return (
    <section className="pbk-lead-portal-card pbk-lead-portal-deal">
      <header>
        <div>
          <span className="pbk-kicker">Motivation &amp; underwriting</span>
          <h2>Deal context</h2>
        </div>
        <BadgeDollarSign size={19} />
      </header>
      <div className="pbk-lead-portal-deal-summary">
        <div>
          <Sparkles />
          <span>Motivation</span>
          <p>{lead.motivation}</p>
        </div>
        <div>
          <Gauge />
          <span>Timeline</span>
          <p>{formatLeadValue(lead.timeline)}</p>
        </div>
      </div>
      <div className="pbk-lead-portal-money-grid">
        <div>
          <span>Asking price</span>
          <strong>{formatLeadMoney(lead.askingPrice)}</strong>
        </div>
        <div>
          <span>ARV</span>
          <strong>{formatLeadMoney(lead.arv)}</strong>
        </div>
        <div className="accent">
          <span>MAO</span>
          <strong>{formatLeadMoney(lead.mao)}</strong>
        </div>
        <div>
          <span>Estimated repairs</span>
          <strong>{formatLeadMoney(lead.estimatedRepairs)}</strong>
        </div>
        <div>
          <span>Mortgage balance</span>
          <strong>{formatLeadMoney(lead.mortgageBalance)}</strong>
        </div>
        <div>
          <span>Selected path</span>
          <strong>{lead.pathLabel}</strong>
        </div>
      </div>
      {lead.tags.length > 0 && (
        <div className="pbk-lead-portal-tags" aria-label="Lead tags">
          <CircleDollarSign size={15} />
          {lead.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
    </section>
  );
}
