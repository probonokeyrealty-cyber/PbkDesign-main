import { Building2, Home, MapPin, Ruler } from 'lucide-react';
import type { LeadPortalModel } from './leadPortalModel';
import { formatLeadValue } from './leadPortalModel';

function numberLabel(value: number | null, suffix = '') {
  return value === null ? 'Not captured' : `${value.toLocaleString()}${suffix}`;
}

export function LeadPortalProperty({ lead }: { lead: LeadPortalModel }) {
  const locality = [lead.city, lead.state, lead.zip].filter(Boolean).join(', ');
  return (
    <section className="pbk-lead-portal-card">
      <header>
        <div>
          <span className="pbk-kicker">Address &amp; asset details</span>
          <h2>Property</h2>
        </div>
        <Home size={19} />
      </header>
      <div className="pbk-lead-portal-property-address">
        <MapPin size={17} />
        <div>
          <strong>{lead.address || 'Address not captured'}</strong>
          <span>{locality || 'City, state, and ZIP not captured'}</span>
        </div>
      </div>
      <div className="pbk-lead-portal-property-grid">
        <div>
          <Building2 />
          <span>Type</span>
          <strong>{lead.propertyType}</strong>
        </div>
        <div>
          <Ruler />
          <span>Size</span>
          <strong>{numberLabel(lead.sqft, ' sq ft')}</strong>
        </div>
        <div>
          <span>Beds / baths</span>
          <strong>
            {lead.beds === null && lead.baths === null
              ? 'Not captured'
              : `${lead.beds ?? '-'} / ${lead.baths ?? '-'}`}
          </strong>
        </div>
        <div>
          <span>Year built</span>
          <strong>{numberLabel(lead.yearBuilt)}</strong>
        </div>
        <div>
          <span>Occupancy</span>
          <strong>{formatLeadValue(lead.occupancy)}</strong>
        </div>
        <div>
          <span>Condition</span>
          <strong>{formatLeadValue(lead.condition)}</strong>
        </div>
      </div>
    </section>
  );
}
