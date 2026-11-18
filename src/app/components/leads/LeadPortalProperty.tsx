import { useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { Building2, ExternalLink, FileSearch, Pencil } from 'lucide-react';
import { LeadListingPhotos } from '../AnalyzerListingLookup';
import type { LeadPortalModel } from './leadPortalModel';
import { formatLeadValue } from './leadPortalModel';
import { LeadComps } from './LeadComps';
import { listingSources, readPropertyEvidence } from '../../utils/propertyEvidence';
import { formatCurrency } from '../../utils/formatting';
import {
  AttomPropertyPreview,
  hasLookupAddress,
  propertyAddressLabel,
} from './AttomPropertyPreview';

function numberLabel(value: number | null, suffix = '') {
  return value === null ? 'Not captured' : `${value.toLocaleString()}${suffix}`;
}

function ZillowLink({ href }: { href: string }) {
  return (
    <a
      className="pbk-btn pbk-btn-ghost pbk-btn-sm"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      Open on Zillow <ExternalLink size={14} aria-hidden />
    </a>
  );
}

export function LeadPortalProperty({
  lead,
  onEdit,
}: {
  lead: LeadPortalModel;
  onEdit: () => void;
}) {
  const [tab, setTab] = useState('overview');
  const recordTabRef = useRef<HTMLButtonElement>(null);
  const locality = [lead.city, [lead.state, lead.zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  const address = { street: lead.address, city: lead.city, state: lead.state, zip: lead.zip };
  const fullAddress = propertyAddressLabel(address);
  const evidence = readPropertyEvidence(lead.raw.deal, fullAddress);
  const parcel = evidence.records?.facts;
  const missing = [
    !address.street.trim() ? 'street' : '',
    !address.city.trim() ? 'city' : '',
    !/^[a-z]{2}$/i.test(address.state.trim()) ? 'state' : '',
    !/^\d{5}(?:-\d{4})?$/.test(address.zip.trim()) ? 'ZIP' : '',
  ].filter(Boolean);
  const zillowHref = hasLookupAddress(address)
    ? `https://www.zillow.com/homes/${encodeURIComponent(propertyAddressLabel(address).replace(/\s+/g, '-'))}_rb/`
    : null;
  return (
    <section
      className="pbk-lead-portal-card pbk-property-workspace"
      id="lead-property"
      aria-labelledby="lead-property-heading"
    >
      <header className="pbk-property-header">
        <div className="pbk-property-identity">
          <h2 id="lead-property-heading">Property</h2>
          <strong>{lead.address || 'Address not captured'}</strong>
          {locality && <p>{locality}</p>}
          <p className="pbk-property-lead-meta">
            {formatLeadValue(lead.stage)} / {formatLeadValue(lead.propertyType)}
          </p>
        </div>
        <div className="pbk-property-actions">
          <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={onEdit}>
            <Pencil size={14} aria-hidden /> Edit lead
          </button>
          {zillowHref && <ZillowLink href={zillowHref} />}
        </div>
      </header>
      <dl className="pbk-property-key-facts" aria-label="Key facts from the saved lead">
        <div>
          <dt>Beds / baths</dt>
          <dd>
            {lead.beds === null && lead.baths === null
              ? 'Not captured'
              : `${lead.beds ?? '-'} / ${lead.baths ?? '-'}`}
          </dd>
        </div>
        <div>
          <dt>Living area</dt>
          <dd>{numberLabel(lead.sqft, ' sq ft')}</dd>
        </div>
        <div>
          <dt>Year built</dt>
          <dd>{lead.yearBuilt ?? 'Not captured'}</dd>
        </div>
      </dl>
      <div className="pbk-property-next-step" role="group" aria-label="Property evidence next step">
        <FileSearch size={18} aria-hidden="true" />
        <div>
          <h3>{missing.length ? 'Address incomplete' : 'Property record review'}</h3>
          <p>
            {missing.length
              ? `Missing ${missing.join(', ')}`
              : 'Saved facts and provider records stay separate'}
          </p>
        </div>
        <button
          type="button"
          className="pbk-btn pbk-btn-ghost pbk-btn-sm"
          onClick={() => {
            if (missing.length) onEdit();
            else {
              setTab('record');
              recordTabRef.current?.focus();
            }
          }}
        >
          {missing.length ? 'Complete address' : 'Review property record'}
        </button>
      </div>
      <Tabs.Root value={tab} onValueChange={setTab} activationMode="manual">
        <Tabs.List aria-label="Property workspace sections" className="pbk-property-tabs">
          <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger ref={recordTabRef} value="record">
            Property record
          </Tabs.Trigger>
          <Tabs.Trigger value="photos">Photos</Tabs.Trigger>
          <Tabs.Trigger value="comps">Comps</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="overview" className="pbk-property-tab-panel">
          <div className="pbk-property-evidence-grid">
            <div className="pbk-property-gallery">
              <LeadListingPhotos
                key={fullAddress}
                address={hasLookupAddress(address) ? fullAddress : ''}
                snapshot={evidence.listing}
              />
            </div>
            <div className="pbk-property-evidence-summary">
              <div className="pbk-property-group-heading">
                <Building2 size={16} aria-hidden />
                <h3>Property at a glance</h3>
              </div>
              <dl className="pbk-property-evidence-facts">
                <div>
                  <dt>Saved asking price</dt>
                  <dd>
                    {lead.askingPrice === null ? 'Not captured' : formatCurrency(lead.askingPrice)}
                  </dd>
                </div>
                <div>
                  <dt>Days on market · listing</dt>
                  <dd>{evidence.listing?.facts.dom ?? 'Not captured'}</dd>
                </div>
                <div>
                  <dt>Parcel / APN · ATTOM</dt>
                  <dd>{parcel?.apn || 'Not captured'}</dd>
                </div>
                <div>
                  <dt>Lot area · ATTOM</dt>
                  <dd>{numberLabel(parcel?.lotSqft ?? null, ' sq ft')}</dd>
                </div>
                <div>
                  <dt>Annual tax · ATTOM{parcel?.taxYear ? ` (${parcel.taxYear})` : ''}</dt>
                  <dd>
                    {parcel?.taxAmount == null ? 'Not captured' : formatCurrency(parcel.taxAmount)}
                  </dd>
                </div>
                <div>
                  <dt>Recorded transfer · not a comp</dt>
                  <dd>
                    {parcel?.recordedSaleAmount == null
                      ? 'Not captured'
                      : formatCurrency(parcel.recordedSaleAmount)}
                    {parcel?.recordedSaleDate && <small>{parcel.recordedSaleDate}</small>}
                  </dd>
                </div>
              </dl>
              {evidence.listing && (
                <div className="pbk-property-source-links" aria-label="Listing sources">
                  {listingSources(evidence.listing.sourceLinks).map(([href, name]) => (
                    <a key={href} href={href} target="_blank" rel="noopener noreferrer">
                      {name}
                      <ExternalLink size={13} aria-hidden />
                    </a>
                  ))}
                </div>
              )}
              <p className="pbk-property-evidence-note">
                Listing facts and public records may differ. Review the property record before
                changing saved facts or underwriting.
              </p>
              {evidence.records && (
                <p className="pbk-property-evidence-note">
                  Public records captured{' '}
                  <time dateTime={evidence.records.retrievedAt}>
                    {new Date(evidence.records.retrievedAt).toLocaleString()}
                  </time>
                  .
                </p>
              )}
            </div>
          </div>
          <div className="pbk-property-group-heading">
            <Building2 size={16} aria-hidden />
            <h3>Saved lead facts</h3>
          </div>
          <dl className="pbk-property-overview">
            <div>
              <dt>Property type</dt>
              <dd>{formatLeadValue(lead.propertyType)}</dd>
            </div>
            <div>
              <dt>Occupancy</dt>
              <dd>{formatLeadValue(lead.occupancy)}</dd>
            </div>
            <div>
              <dt>Condition</dt>
              <dd>{formatLeadValue(lead.condition)}</dd>
            </div>
          </dl>
        </Tabs.Content>
        <Tabs.Content
          value="record"
          forceMount
          hidden={tab !== 'record'}
          tabIndex={tab === 'record' ? 0 : -1}
          className="pbk-property-tab-panel"
        >
          <AttomPropertyPreview
            mode="workspace"
            snapshot={evidence.records}
            address={address}
            saved={{
              propertyType: /^(?:not captured|unknown)$/i.test(lead.propertyType)
                ? null
                : formatLeadValue(lead.propertyType),
              livingSqft: lead.sqft,
              beds: lead.beds,
              baths: lead.baths,
              yearBuilt: lead.yearBuilt,
            }}
          />
        </Tabs.Content>
        <Tabs.Content value="comps" className="pbk-property-tab-panel">
          <LeadComps address={address} leadId={lead.id} />
        </Tabs.Content>
        <Tabs.Content value="photos" className="pbk-property-tab-panel">
          <LeadListingPhotos
            key={fullAddress}
            address={hasLookupAddress(address) ? fullAddress : ''}
            snapshot={evidence.listing}
          />
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}
