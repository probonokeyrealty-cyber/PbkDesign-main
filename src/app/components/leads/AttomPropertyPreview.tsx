import { useState } from 'react';
import { Check, CircleAlert, Database, Loader2, Minus, Search } from 'lucide-react';
import {
  fetchAttomPropertyPreview,
  type AttomPreviewAddress,
  type AttomPreviewResult,
  type AttomPropertyFacts,
} from '../../utils/runtimeBridge';

type SavedFacts = Partial<Pick<AttomPropertyFacts, 'propertyType' | 'beds' | 'baths' | 'livingSqft' | 'yearBuilt'>>;
type PreviewProps = { address: AttomPreviewAddress; saved: SavedFacts; mode: 'workspace' | 'draft' };
type FactRow = { label: string; value: string | number | null; saved?: string | number | null; equivalent?: boolean };
const messages = {
  invalid_address: 'Enter the full street address, city, state, and ZIP.',
  not_configured: 'ATTOM lookup is not enabled.',
  not_found: 'ATTOM has no record for this address.',
  ambiguous: 'ATTOM could not confirm one exact parcel. Check the address and unit.',
  unavailable: 'ATTOM lookup is unavailable. Try again later.',
  authorization_failed: 'ATTOM did not authorize the lookup. Check the provider connection.',
  rate_limited: 'ATTOM is limiting requests. Wait before retrying.',
  timed_out: 'ATTOM took too long to respond.',
};
const retryable = new Set(['timed_out', 'rate_limited', 'unavailable']);
const money = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
});
const area = (value: number | null, unit: string) =>
  value == null ? null : `${value.toLocaleString()} ${unit}`;
const rowStatuses = {
  match: 'Match',
  different: 'Differs',
  record: 'Only in record',
  lead: 'Only in lead',
  missing: 'Not available',
} as const;

export function propertyAddressLabel({ street, city, state, zip }: AttomPreviewAddress) {
  return [street.trim(), city.trim(), [state.trim(), zip.trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

export function hasLookupAddress({ street, city, state, zip }: AttomPreviewAddress) {
  return Boolean(street.trim() && city.trim() && /^[a-z]{2}$/i.test(state.trim()) && /^\d{5}(?:-\d{4})?$/.test(zip.trim()));
}

function rowStatus({ saved, value, equivalent }: FactRow): keyof typeof rowStatuses {
  if (saved == null) return value == null ? 'missing' : 'record';
  if (value == null) return 'lead';
  return saved === value || equivalent ? 'match' : 'different';
}

function propertyTypeKey(value: string | null | undefined) {
  const type = value?.trim().toLowerCase().replace(/[-_\s]+/g, ' ');
  return /^(?:house|(?:detached )?single family(?: residence| residential)?)$/.test(type ?? '')
    ? 'single family' : type;
}

export function AttomPropertyPreview(props: PreviewProps) {
  return <PropertyLookup key={JSON.stringify(props.address)} {...props} />;
}

function PropertyLookup({ address, saved, mode }: PreviewProps) {
  const [result, setResult] = useState<AttomPreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookedUpAt, setLookedUpAt] = useState<Date | null>(null);
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const isDraft = mode === 'draft';
  const typedAddress = propertyAddressLabel(address);
  const completeAddress = hasLookupAddress(address);

  async function lookup() {
    if (loading || !completeAddress) return;
    setLoading(true);
    setResult(null);
    setDifferencesOnly(false);
    try {
      setResult((await fetchAttomPropertyPreview(address)) || { status: 'unavailable' });
      setLookedUpAt(new Date());
    } catch {
      setResult({ status: 'unavailable' });
    } finally {
      setLoading(false);
    }
  }

  const profile = result?.status === 'matched' ? result.profile : null;
  const facts: FactRow[] = profile ? [
    { label: 'Property type', value: profile.propertyType, saved: saved.propertyType,
      equivalent: propertyTypeKey(saved.propertyType) === propertyTypeKey(profile.propertyType) },
    { label: 'Living area', value: area(profile.livingSqft, 'sq ft'), saved: area(saved.livingSqft ?? null, 'sq ft') },
    { label: 'Beds', value: profile.beds, saved: saved.beds },
    { label: 'Baths', value: profile.baths, saved: saved.baths },
    { label: 'Year built', value: profile.yearBuilt, saved: saved.yearBuilt },
    { label: 'Lot size', value: area(profile.lotSqft, 'sq ft') ?? area(profile.lotAcres, 'acres') },
  ] : [];
  const differences = facts.filter((fact) => rowStatus(fact) === 'different');
  const remaining = facts.filter((fact) => rowStatus(fact) !== 'different');
  const visibleFacts = differencesOnly ? differences : [...differences, ...remaining];
  const enteredFacts = [
    saved.beds != null ? `${saved.beds} bd` : '',
    saved.baths != null ? `${saved.baths} ba` : '',
    area(saved.livingSqft ?? null, 'sq ft'),
  ].filter(Boolean).join(' / ');
  return (
    <section className="pbk-attom-preview" data-mode={mode} aria-label="ATTOM property preview">
      {isDraft && (
        <div className="pbk-attom-draft-address">
          <span>Lead preview</span>
          <strong>{typedAddress || 'No address entered'}</strong>
          {enteredFacts && <p>{enteredFacts}</p>}
        </div>
      )}
      <div className="pbk-attom-preview-head">
        <div className="pbk-attom-title"><Database size={16} aria-hidden /><h3>{isDraft ? 'Address lookup preview' : 'ATTOM property records'}</h3></div>
        <span className="pbk-property-label">Read only</span>
      </div>
      <div className="pbk-attom-layout" data-matched={Boolean(profile)}>
        <div className="pbk-attom-lookup">
          <div className="pbk-attom-lookup-top">
            <div role="status" data-matched={Boolean(profile)}>
              {loading ? 'Looking up property...' : result && result.status !== 'matched'
                ? messages[result.status] ?? messages.unavailable : profile ? 'Exact address match' : null}
            </div>
            {!loading && !result && !completeAddress && <p>{messages.invalid_address}</p>}
            <button
              type="button"
              className="pbk-btn pbk-btn-ghost pbk-btn-sm"
              disabled={loading || !completeAddress}
              onClick={() => void lookup()}
            >
              {loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Search size={15} aria-hidden />}
              {result && retryable.has(result.status) ? 'Retry lookup' : profile ? 'Run lookup again' : 'Look up property'}
            </button>
          </div>
          {profile && (
            <dl className="pbk-attom-source">
              {!isDraft && <div><dt>Address sent</dt><dd>{typedAddress}</dd></div>}
              <div><dt>Address returned</dt><dd>{profile.address}</dd></div>
              {profile.apn && <div><dt>Parcel (APN)</dt><dd>{profile.apn}</dd></div>}
              {lookedUpAt && <div><dt>Checked</dt><dd><time dateTime={lookedUpAt.toISOString()}>{lookedUpAt.toLocaleString()}</time></dd></div>}
            </dl>
          )}
        </div>
        {profile && (
          <div className="pbk-attom-comparison">
            {!isDraft && (
              <div className="pbk-attom-comparison-head">
                <h4>Saved lead vs. ATTOM record</h4>
                <div className="pbk-attom-filter" role="group" aria-label="Filter property records">
                  <button type="button" aria-pressed={!differencesOnly} onClick={() => setDifferencesOnly(false)}>All fields ({facts.length})</button>
                  <button type="button" aria-pressed={differencesOnly} onClick={() => setDifferencesOnly(true)}>Differences only ({differences.length})</button>
                </div>
              </div>
            )}
            {visibleFacts.length ? (
              <dl className="pbk-attom-rows">
                {visibleFacts.map((fact) => <ComparisonRow key={fact.label} fact={fact} isDraft={isDraft} />)}
              </dl>
            ) : <p className="pbk-attom-no-differences">No conflicting values.</p>}
            {(profile.taxAmount != null || profile.recordedSaleAmount != null || profile.recordedSaleDate) && (
              <details className="pbk-attom-record-details">
                <summary>Taxes and recorded transfer</summary>
                <dl className="pbk-attom-facts">
                  {profile.taxAmount != null && (
                    <Fact label={profile.taxYear == null ? 'Property tax' : `Property tax (${profile.taxYear})`}
                      value={money.format(profile.taxAmount)} />
                  )}
                  {profile.recordedSaleAmount != null && (
                    <Fact label="Reported transfer amount (not a comp)" value={money.format(profile.recordedSaleAmount)} />
                  )}
                  {profile.recordedSaleDate && <Fact label="Transfer recorded on" value={profile.recordedSaleDate} />}
                </dl>
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ComparisonRow({ fact, isDraft }: { fact: FactRow; isDraft: boolean }) {
  const status = rowStatus(fact);
  const Icon = status === 'match' ? Check : status === 'different' ? CircleAlert : Minus;
  return (
    <div data-status={status}>
      <dt>{fact.label}</dt>
      <dd><small>{isDraft ? 'You typed' : 'Saved lead'}</small><strong>{fact.saved ?? 'Not entered'}</strong></dd>
      <dd><small>ATTOM record</small><strong>{fact.value ?? 'Not on record'}</strong></dd>
      <dd className="pbk-attom-row-status"><Icon size={13} aria-hidden />{isDraft && status === 'lead' ? 'Only in draft' : rowStatuses[status]}</dd>
    </div>
  );
}

function Fact({ label, value }: FactRow) {
  return <div><dt>{label}</dt><dd><strong>{value ?? 'Not on record'}</strong></dd></div>;
}
