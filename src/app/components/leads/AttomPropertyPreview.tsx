import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import {
  fetchAttomPropertyPreview,
  type AttomPreviewAddress,
  type AttomPreviewResult,
  type AttomPropertyFacts,
} from '../../utils/runtimeBridge';

type SavedFacts = Pick<AttomPropertyFacts, 'propertyType' | 'beds' | 'baths' | 'livingSqft' | 'yearBuilt'>;
type PreviewProps = { address: AttomPreviewAddress; saved?: SavedFacts; comparison?: boolean };
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
const differs = ({ saved, value, equivalent }: FactRow) => saved != null && value != null && saved !== value && !equivalent;

function propertyTypeKey(value: string | null | undefined) {
  const type = value?.trim().toLowerCase().replace(/[-_\s]+/g, ' ');
  return /^(?:house|(?:detached )?single family(?: residence| residential)?)$/.test(type ?? '')
    ? 'single family' : type;
}

export function AttomPropertyPreview(props: PreviewProps) {
  return <PropertyLookup key={JSON.stringify(props.address)} {...props} />;
}

function PropertyLookup({ address, saved, comparison = false }: PreviewProps) {
  const [result, setResult] = useState<AttomPreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookedUpAt, setLookedUpAt] = useState<Date | null>(null);

  async function lookup() {
    setLoading(true);
    setResult(null);
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
    { label: 'Property type', value: profile.propertyType, saved: saved?.propertyType,
      equivalent: propertyTypeKey(saved?.propertyType) === propertyTypeKey(profile.propertyType) },
    { label: 'Living area', value: area(profile.livingSqft, 'sq ft'), saved: area(saved?.livingSqft ?? null, 'sq ft') },
    { label: 'Lot size', value: area(profile.lotSqft, 'sq ft') ?? area(profile.lotAcres, 'acres') },
    { label: 'Beds', value: profile.beds, saved: saved?.beds },
    { label: 'Baths', value: profile.baths, saved: saved?.baths },
    { label: 'Year built', value: profile.yearBuilt, saved: saved?.yearBuilt },
  ] : [];
  facts.sort((a, b) => Number(differs(b)) - Number(differs(a)));
  return (
    <section className="pbk-attom-preview" data-comparison={comparison || undefined} aria-label="ATTOM property preview">
      <div className="pbk-attom-preview-head">
        <strong>ATTOM property records</strong>
        <button
          type="button"
          className="pbk-btn pbk-btn-ghost pbk-btn-sm"
          disabled={loading || !address.street.trim()}
          onClick={() => void lookup()}
        >
          {loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Search size={15} aria-hidden />}
          {result && retryable.has(result.status) ? 'Retry lookup' : 'Look up property'}
        </button>
      </div>
      <div className={profile ? 'pbk-attom-match' : undefined}>
        <div role="status">
          {loading ? 'Looking up property...' : result && result.status !== 'matched'
            ? messages[result.status] ?? messages.unavailable : profile ? 'Exact address match' : null}
        </div>
        {profile && (
          <p className="pbk-attom-preview-address">
            <strong>{profile.address}</strong>
            {profile.apn && <small>Parcel (APN) {profile.apn}</small>}
            {lookedUpAt && <small>Checked <time dateTime={lookedUpAt.toISOString()}>{lookedUpAt.toLocaleString()}</time></small>}
          </p>
        )}
      </div>
      {profile && (
        <>
          {comparison ? <RecordComparison facts={facts} /> : (
            <dl className="pbk-attom-facts">
              {facts.map((fact) => <Fact key={fact.label} {...fact} />)}
            </dl>
          )}
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
        </>
      )}
    </section>
  );
}

function RecordComparison({ facts }: { facts: FactRow[] }) {
  const differences = facts.filter(differs);
  const building = facts.filter((fact) => fact.label !== 'Lot size' && !differs(fact));
  const lot = facts.filter((fact) => fact.label === 'Lot size' && !differs(fact));
  return (
    <div className="pbk-attom-comparison">
      {differences.length > 0 && (
        <section className="pbk-attom-conflicts" aria-label="Differences from saved lead">
          <h3>Differences from saved lead ({differences.length})</h3>
          <dl>{differences.map((fact) => <Fact key={fact.label} {...fact} compare />)}</dl>
        </section>
      )}
      <section aria-label="Building">
        <h3>Building</h3>
        <dl>{building.map((fact) => <Fact key={fact.label} {...fact} compare />)}</dl>
      </section>
      <section aria-label="Parcel and lot">
        <h3>Parcel / lot</h3>
        <dl>{lot.map((fact) => <Fact key={fact.label} {...fact} compare />)}</dl>
      </section>
    </div>
  );
}

function Fact({ label, value, saved, equivalent, compare = false }: FactRow & { compare?: boolean }) {
  const different = differs({ label, value, saved, equivalent });
  return (
    <div>
      <dt>{label}</dt>
      {(compare || saved != null) && <dd><small>Saved lead</small><strong>{saved ?? 'Not captured'}</strong></dd>}
      <dd>{(compare || saved != null) && <small>ATTOM record</small>}<strong>{value ?? 'Not on record'}</strong></dd>
      {different && <dd className="pbk-attom-difference">Differs from saved</dd>}
    </div>
  );
}
