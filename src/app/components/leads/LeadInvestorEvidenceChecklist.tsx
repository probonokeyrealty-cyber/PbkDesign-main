import { useId } from 'react';
import type { readPropertyEvidence } from '../../utils/propertyEvidence';
import '../../../styles/lead-investor-evidence-checklist.css';

const captureDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

export type InvestorEvidenceDestination = 'comps' | 'investor';

export default function LeadInvestorEvidenceChecklist({
  evidence,
  onOpen,
}: {
  evidence: ReturnType<typeof readPropertyEvidence>;
  onOpen?: (destination: InvestorEvidenceDestination) => void;
}) {
  const titleId = useId();
  const { listing, records } = evidence;
  const hasAskAndSize = Boolean(listing?.askingPrice && listing.facts.sqft > 0);
  const hasParcelId = Boolean(records?.facts.apn);
  const nextStep = !listing
    ? 'Find a listing or current asking price for this address.'
    : !hasParcelId
      ? 'Confirm the parcel ID with the local assessor.'
      : !hasAskAndSize
        ? 'Confirm the asking price and usable living area.'
        : 'Review nearby closed sales before estimating the property’s value.';

  return (
    <section className="pbk-market-checklist" aria-labelledby={titleId}>
      <header className="pbk-market-section-header">
        <h4 id={titleId}>Investor evidence checklist</h4>
        <p>{nextStep}</p>
      </header>
      <dl className="pbk-market-checklist-snapshots">
        <div>
          <dt>{hasAskAndSize ? 'Listing price and size saved' : listing ? 'Listing details incomplete' : 'Matching listing missing'}</dt>
          <dd>{listing
            ? <time dateTime={listing.retrievedAt}>Captured {captureDate.format(new Date(listing.retrievedAt))}</time>
            : 'Use evidence for this exact address.'}</dd>
        </div>
        <div>
          <dt>{hasParcelId ? 'Parcel ID saved' : records ? 'Parcel ID missing' : 'Parcel record missing'}</dt>
          <dd>{records
            ? <time dateTime={records.retrievedAt}>ATTOM snapshot · {captureDate.format(new Date(records.retrievedAt))}</time>
            : 'Use the local assessor’s parcel record.'}</dd>
        </div>
      </dl>
      <div className="pbk-market-checklist-actions">
        <a href="https://blog.reventure.app/graph" target="_blank" rel="noopener noreferrer">Reventure research hub</a>
        {onOpen && (
          <>
            <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => onOpen('comps')}>Open Comps</button>
            <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => onOpen('investor')}>Open Investor</button>
          </>
        )}
      </div>
      <div className="pbk-market-checklist-details">
        <details className="pbk-market-sources">
          <summary>What supports the price?</summary>
          <p>Record dated, nearby closed sales from licensed comps or county records. Match property type, size and condition. Document which sales support as-is value and which support after-repair value.</p>
        </details>
        <details className="pbk-market-sources">
          <summary>Costs, financing and downside</summary>
          <p>Get an inspection and itemized contractor bid. Add contingencies, taxes, insurance, HOA dues, financing, closing, holding and selling costs. Use the Investor decision brief to check a lower resale price, higher repair costs and a longer hold.</p>
        </details>
        <details className="pbk-market-sources">
          <summary>What supports the rent?</summary>
          <p>Use recent comparable leases and any existing rent roll or lease terms. Include vacancy, management, maintenance and reserves when estimating cash flow.</p>
        </details>
        <details className="pbk-market-sources">
          <summary>Title, permits and property risks</summary>
          <p>Request a title report for liens and restrictions. Check allowed use and permits with the local jurisdiction, and get a property-specific insurance quote.</p>
          <p><a href="https://msc.fema.gov/" target="_blank" rel="noopener noreferrer">Check FEMA flood maps</a></p>
        </details>
        <details className="pbk-market-sources">
          <summary>How fast are comparable homes moving?</summary>
          <p>Check recent sales volume, days on market, inventory and price cuts in Reventure. Record the geography and period. The charts here use fictional trend data and separately labeled public snapshots.</p>
        </details>
      </div>
    </section>
  );
}
