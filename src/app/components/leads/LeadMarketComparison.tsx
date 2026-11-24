import { lazy, Suspense } from 'react';
import { formatCurrency } from '../../utils/formatting';
import type { readPropertyEvidence } from '../../utils/propertyEvidence';
import type { InvestorEvidenceDestination } from './LeadInvestorEvidenceChecklist';
import { VAN_NUYS_ZCTA } from './marketStagingData';
import type { LeadPortalModel } from './leadPortalModel';
import '../../../styles/lead-market-comparison.css';

const LeadFictionalMarketTrends = import.meta.env.PBK_MARKET_STAGING_INDICATORS
  ? lazy(() => import('./LeadFictionalMarketTrends'))
  : null;
const LeadInvestorEvidenceChecklist = import.meta.env.PBK_MARKET_STAGING_INDICATORS
  ? lazy(() => import('./LeadInvestorEvidenceChecklist'))
  : null;
const LeadPublicMarketPilot = import.meta.env.PBK_MARKET_91411_PILOT
  ? lazy(() => import('./LeadPublicMarketPilot'))
  : null;
const LeadPublicHousingContext = lazy(() => import('./LeadPublicHousingContext'));

const zipFixture = {
  zip: '90210',
  propertyType: 'single-family',
  start: '2026-09-02',
  end: '2026-11-30',
  askingPrice: 695000,
  askingPerSqft: 438,
  activeDays: 27,
  listingCount: 24,
  areaCount: 21,
  activeInventory: 32,
  closedSales: 18,
  threeBedroomRent: 3200,
  rentalCount: 10,
} as const;

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
const positive = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
const singleFamily = (value: string) =>
  /^(?:sfr|single[- ]family(?: (?:residence|residential|home|detached))?)$/i.test(value.trim());
const formatDays = (value: number) => `${value} ${value === 1 ? 'day' : 'days'}`;

function describeGap(subject: number, benchmark: number, unit: 'percent' | 'days') {
  if (subject === benchmark) return 'Matches the fictional ZIP benchmark';
  if (unit === 'days')
    return `${formatDays(Math.abs(subject - benchmark))} ${subject > benchmark ? 'more' : 'fewer'} than the fictional ZIP benchmark`;
  const gap = Math.abs(((subject - benchmark) / benchmark) * 100);
  if (gap < 0.1) return 'Within 0.1% of the fictional ZIP benchmark';
  return `${gap.toFixed(1)}% ${subject > benchmark ? 'above' : 'below'} fictional ZIP median`;
}

function Metric({
  name,
  subject,
  benchmark,
  format,
  note,
  compare = false,
  unit = 'percent',
}: {
  name: string;
  subject: number | null;
  benchmark: number | null;
  format: (value: number) => string;
  note: string;
  compare?: boolean;
  unit?: 'percent' | 'days';
}) {
  const paired = compare && subject !== null && benchmark !== null;
  const scale = paired ? Math.max(subject, benchmark) : 0;
  return (
    <article className="pbk-market-metric" aria-label={name}>
      <h4>{name}</h4>
      <dl>
        <div>
          <dt>Saved house</dt>
          <dd>{subject === null ? 'Not captured' : format(subject)}</dd>
        </div>
        <div>
          <dt>Fictional ZIP median</dt>
          <dd>{benchmark === null ? 'Unavailable' : format(benchmark)}</dd>
        </div>
      </dl>
      {paired && (
        <>
          {scale > 0 && (
            <div className="pbk-market-bars" aria-hidden="true">
              <span>
                <i style={{ width: `${(subject / scale) * 100}%` }} />
              </span>
              <span>
                <i style={{ width: `${(benchmark / scale) * 100}%` }} />
              </span>
            </div>
          )}
          <strong>{describeGap(subject, benchmark, unit)}</strong>
        </>
      )}
      <small>{note}</small>
    </article>
  );
}

export function LeadMarketComparison({
  lead,
  evidence,
  onOpenEvidence,
}: {
  lead: Pick<LeadPortalModel, 'zip' | 'propertyType'>;
  evidence: ReturnType<typeof readPropertyEvidence>;
  onOpenEvidence?: (destination: InvestorEvidenceDestination) => void;
}) {
  const { listing, records } = evidence;
  const zip = /^(\d{5})(?:-\d{4})?$/.exec(lead.zip.trim())?.[1];
  const PublicMarketPilot = zip === VAN_NUYS_ZCTA ? LeadPublicMarketPilot : null;
  const savedType = records?.facts.propertyType;
  const leadType = lead.propertyType.trim();
  const typeMatches =
    singleFamily(savedType || leadType) &&
    (!savedType || !leadType || leadType === 'Not captured' || singleFamily(leadType));
  const cohort = zip === zipFixture.zip && typeMatches ? zipFixture : null;
  const capturedDay = listing ? new Date(listing.retrievedAt).toISOString().slice(0, 10) : null;
  const inWindow = Boolean(
    cohort && capturedDay && capturedDay >= cohort.start && capturedDay <= cohort.end
  );
  const askingPrice = positive(listing?.askingPrice);
  const listingArea = positive(listing?.facts.sqft);
  const pricePerArea =
    askingPrice !== null && listingArea !== null ? positive(askingPrice / listingArea) : null;
  const recordedPrice = positive(records?.facts.recordedSaleAmount);
  const recordedDate = records?.facts.recordedSaleDate;
  const rentalMatch = cohort && listing?.facts.beds === 3 ? cohort : null;
  const listingNote = cohort
    ? `Fictional sample: ${cohort.listingCount} single-family listings.`
    : 'No fictional ZIP listing benchmark.';

  return (
    <div className="pbk-market-comparison">
      <header className="pbk-market-hero">
        <svg
          viewBox="0 0 48 48"
          width="44"
          height="44"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 22 14 13l10 9v13H5V22m6 13v-7h6v7M28 14h14v22H28m0-15h14m-14 7h14m-7-14v22" />
        </svg>
        <div>
          <span className="pbk-market-badge">Market comparison</span>
          <h3>House vs. ZIP</h3>
          <p>
            Compare public housing estimates by ZIP, then review what was saved for this property.
          </p>
          <div className="pbk-market-context">
            <strong>{zip ? `ZIP ${zip}` : 'ZIP not captured'}</strong>
            <span>Read-only snapshot</span>
          </div>
        </div>
      </header>
      {PublicMarketPilot && (
        <Suspense fallback={<p role="status">Loading public-data pilot…</p>}>
          <PublicMarketPilot />
        </Suspense>
      )}
      {LeadInvestorEvidenceChecklist && (
        <Suspense fallback={<p role="status">Loading investor evidence checklist…</p>}>
          <LeadInvestorEvidenceChecklist evidence={evidence} onOpen={onOpenEvidence} />
        </Suspense>
      )}
      {zip ? (
        <Suspense fallback={<p role="status">Loading public housing snapshot...</p>}>
          <LeadPublicHousingContext
            zip={zip}
            savedAsk={
              listing && askingPrice !== null
                ? {
                    amount: askingPrice,
                    capturedAt: listing.retrievedAt,
                    date: dateLabel(listing.retrievedAt),
                  }
                : null
            }
          />
        </Suspense>
      ) : (
        <p className="pbk-market-notice">Public housing context requires a saved five-digit ZIP.</p>
      )}

      <section className="pbk-market-evidence" aria-label="Saved property evidence">
        <header className="pbk-market-section-header">
          <span className="pbk-market-badge pbk-market-badge-example">
            Fictional ZIP benchmarks
          </span>
          <h4>Saved property evidence</h4>
          <p>Saved house facts are separate from the fictional ZIP examples below.</p>
        </header>
        {(cohort || listing) && (
          <div className="pbk-market-context">
            {cohort && (
              <span>
                Fictional benchmark period: {dateLabel(cohort.start)} to {dateLabel(cohort.end)}
              </span>
            )}
            {listing && (
              <span>
                Saved listing captured{' '}
                <time dateTime={listing.retrievedAt}>{dateLabel(listing.retrievedAt)}</time>
              </span>
            )}
          </div>
        )}

        {!listing && (
          <p className="pbk-market-notice">
            No saved listing evidence matches this address. Lead estimates are not used as listing
            facts.
          </p>
        )}
        {!cohort && (
          <p className="pbk-market-notice">
            No fictional cohort matches this ZIP and property type.
          </p>
        )}
        {cohort && listing && !inWindow && (
          <p className="pbk-market-notice">
            The saved listing was captured outside the fictional benchmark window. Differences are
            withheld.
          </p>
        )}

        <div className="pbk-market-grid">
          <Metric
            name="Asking price"
            subject={askingPrice}
            benchmark={cohort?.askingPrice ?? null}
            format={formatCurrency}
            compare={inWindow}
            note={listingNote}
          />
          <Metric
            name="Asking price per sq ft"
            subject={pricePerArea}
            benchmark={cohort?.askingPerSqft ?? null}
            format={formatCurrency}
            compare={inWindow}
            note={
              cohort
                ? `Fictional sample: ${cohort.areaCount} listings with usable area.`
                : 'Saved asking price divided by saved listing area.'
            }
          />
          <Metric
            name="Active days listed"
            subject={listing?.facts.dom ?? null}
            benchmark={cohort?.activeDays ?? null}
            format={formatDays}
            compare={inWindow}
            unit="days"
            note={listingNote}
          />
          <Metric
            name="Three-bedroom asking rent"
            subject={null}
            benchmark={rentalMatch?.threeBedroomRent ?? null}
            format={formatCurrency}
            note={
              rentalMatch
                ? `No saved subject asking rent. Fictional sample: ${rentalMatch.rentalCount} three-bedroom listings.`
                : 'No saved subject asking rent or matched three-bedroom benchmark.'
            }
          />
        </div>

        {(!PublicMarketPilot || cohort) && (
          <div className="pbk-market-summary">
            {!PublicMarketPilot && (
              <section className="pbk-market-metric" aria-label="Saved recorded sale">
                <h4>Saved recorded sale</h4>
                <p>
                  {recordedPrice !== null && recordedDate ? (
                    <>
                      <strong>{formatCurrency(recordedPrice)}</strong> on{' '}
                      <time dateTime={recordedDate}>{dateLabel(recordedDate)}</time>
                    </>
                  ) : (
                    'No dated sale recorded in saved property evidence.'
                  )}
                </p>
                <small>
                  County record via ATTOM when available. A prior sale is not compared with current
                  asks.
                </small>
              </section>
            )}
            {cohort && (
              <section className="pbk-market-metric" aria-label="Fictional ZIP activity">
                <h4>Fictional ZIP activity</h4>
                <dl>
                  <div>
                    <dt>Active inventory at window end</dt>
                    <dd>{cohort.activeInventory}</dd>
                  </div>
                  <div>
                    <dt>Closed sales in the window</dt>
                    <dd>{cohort.closedSales}</dd>
                  </div>
                </dl>
                <small>ZIP context only. These are not house-level observations.</small>
              </section>
            )}
          </div>
        )}
      </section>
      {LeadFictionalMarketTrends && (
        <Suspense fallback={<p role="status">Loading fictional market trends…</p>}>
          <LeadFictionalMarketTrends />
        </Suspense>
      )}
      <details className="pbk-market-sources">
        <summary>Sources and limits</summary>
        <p>
          This read-only staff view uses saved listing and parcel snapshots for the current address.
          The fictional benchmarks are examples, not estimates of the real ZIP. Public context is
          bundled with the app. This tab does not call providers, update leads, or publish data.
        </p>
      </details>
    </div>
  );
}
