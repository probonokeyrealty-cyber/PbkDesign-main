import { useEffect, useMemo, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { Building2, ExternalLink, FileSearch, Pencil, RefreshCw } from 'lucide-react';
import { fetchPropertyIntelligenceRequest, type RecentSalesResult } from '../../utils/runtimeBridge';
import { LeadListingPhotos } from '../AnalyzerListingLookup';
import type { LeadPortalModel } from './leadPortalModel';
import { formatLeadValue } from './leadPortalModel';
import { LeadComps } from './LeadComps';
import { PropertyEvidenceBrief, type PropertyEvidenceTab } from './PropertyEvidenceBrief';
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
  initialTab = 'overview',
  onEdit,
  onSaved,
}: {
  lead: LeadPortalModel;
  initialTab?: 'overview' | PropertyEvidenceTab;
  onEdit: () => void;
  onSaved: (leadId: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<string>(initialTab);
  const [refreshing, setRefreshing] = useState(false);
  const [compSaving, setCompSaving] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState('');
  const pending = useRef(false);
  const compSavePending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const recordTabRef = useRef<HTMLButtonElement>(null);
  const photoTabRef = useRef<HTMLButtonElement>(null);
  const compTabRef = useRef<HTMLButtonElement>(null);
  function openEvidenceTab(next: PropertyEvidenceTab) {
    setTab(next);
    ({ record: recordTabRef, photos: photoTabRef, comps: compTabRef })[next].current?.focus();
  }
  const locality = [lead.city, [lead.state, lead.zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  const address = { street: lead.address, city: lead.city, state: lead.state, zip: lead.zip };
  const fullAddress = propertyAddressLabel(address);
  const evidence = readPropertyEvidence(lead.raw.deal, fullAddress);
  const identity = `${lead.id}:${fullAddress}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const savedSales = useMemo<RecentSalesResult | null>(() => {
    const analyzer = lead.raw.analyzer && typeof lead.raw.analyzer === 'object' ? lead.raw.analyzer as Record<string, unknown> : {};
    const research = analyzer.recordedSales && typeof analyzer.recordedSales === 'object' ? analyzer.recordedSales as Record<string, unknown> : null;
    const researchAddress = research?.address && typeof research.address === 'object' ? research.address as Record<string, unknown> : {};
    const savedAddress = {street:lead.address,city:lead.city,state:lead.state,zip:lead.zip};
    const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');
    return research && (research.source === 'ATTOM' || research.provider === 'ATTOM') && ['street', 'city', 'state', 'zip'].every(key => normalize(researchAddress[key]) === normalize(savedAddress[key as keyof typeof savedAddress])) && Array.isArray(research.sales)
      ? { ...research, source: 'ATTOM', status: 'matched' } as RecentSalesResult : null;
  }, [lead.raw,lead.address,lead.city,lead.state,lead.zip]);
  async function refreshIntelligence(radiusMiles = 1) {
    if (pending.current || compSavePending.current || !lead.id || !hasLookupAddress(address)) return;
    const requestedIdentity = identity;
    pending.current = true;
    setRefreshing(true); setRefreshStatus('');
    const active = () => mounted.current && currentIdentity.current === requestedIdentity;
    try {
      const response = await fetchPropertyIntelligenceRequest({ address: fullAddress, leadId: lead.id, expectedPropertyAddress: address, radiusMiles });
      if (!active()) return;
      if (!response.ok || !response.saved) throw new Error('Property intelligence was not saved. Refresh again when the bridge is available.');
      await onSaved(lead.id);
      if (active()) setRefreshStatus(
        response.records.status === 'matched' && !response.records.partial && response.sales.status === 'matched'
          ? 'Property intelligence saved. Review suggested sales before underwriting.'
          : 'Property intelligence refreshed. Some sources were unavailable; previously saved evidence is retained.'
      );
    } catch (error) {
      if (active()) setRefreshStatus(error instanceof Error ? error.message : 'Unable to refresh property intelligence. Saved evidence is retained.');
    } finally {
      pending.current = false;
      if (active()) setRefreshing(false);
    }
  }
  const refresh = () => refreshIntelligence();
  const busy = refreshing || compSaving;
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
          <button type="button" className="pbk-btn pbk-btn-primary pbk-btn-sm" disabled={busy || !hasLookupAddress(address)} onClick={() => void refresh()}>
            <RefreshCw size={14} aria-hidden className={refreshing ? 'animate-spin' : undefined} />
            {refreshing ? 'Refreshing property intelligence...' : 'Refresh property intelligence'}
          </button>
          <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={onEdit}>
            <Pencil size={14} aria-hidden /> Edit lead
          </button>
          {zillowHref && <ZillowLink href={zillowHref} />}
        </div>
      </header>
      {refreshStatus && <p className="pbk-property-evidence-note" role="status">{refreshStatus}</p>}
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
          <Tabs.Trigger ref={photoTabRef} value="photos">Photos</Tabs.Trigger>
          <Tabs.Trigger ref={compTabRef} value="comps">Comps</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="overview" className="pbk-property-tab-panel">
          <div className="pbk-property-evidence-grid">
            <div className="pbk-property-gallery">
              <LeadListingPhotos
                key={fullAddress}
                address={hasLookupAddress(address) ? fullAddress : ''}
                snapshot={evidence.listing}
                onRefresh={refresh}
                refreshing={busy}
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
          <PropertyEvidenceBrief records={evidence.records} listing={evidence.listing} sales={savedSales} onOpen={openEvidenceTab} />
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
            onRefresh={refresh}
            refreshing={busy}
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
          <LeadComps address={address} leadId={lead.id} savedSales={savedSales} onRefresh={refreshIntelligence} refreshing={refreshing} onSaved={onSaved} onSavingChange={saving => { compSavePending.current = saving; setCompSaving(saving); }} />
        </Tabs.Content>
        <Tabs.Content value="photos" className="pbk-property-tab-panel">
          <LeadListingPhotos
            key={fullAddress}
            address={hasLookupAddress(address) ? fullAddress : ''}
            snapshot={evidence.listing}
            onRefresh={refresh}
            refreshing={busy}
          />
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}
