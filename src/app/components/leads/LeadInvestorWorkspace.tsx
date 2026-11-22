import { useState } from 'react';
import { Link, type LinkProps } from 'react-router';
import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Calculator,
  ClipboardList,
  Layers3,
} from 'lucide-react';
import { attomMcpDatasetDefinitions, type AttomMcpSection } from '../../utils/attomMcpSections.mjs';
import { reviewedCompIds } from '../../utils/leadComps.mjs';
import type { readPropertyEvidence } from '../../utils/propertyEvidence';
import type { AttomPreviewAddress, RecentSalesResult } from '../../utils/runtimeBridge';
import { decisionEvidenceVersion } from '../../utils/investorDecisionBrief.mjs';
import { LeadDealDecisionBrief } from './LeadDealDecisionBrief';
import type { LeadPortalModel } from './leadPortalModel';
import { calculateScenario, scenarioFields, type ScenarioInputs } from './investorScenario';
import { investorGlossary, strategyGuides, type InvestorStrategy } from './investorStrategies';
import '../../../styles/lead-investor.css';

type Evidence = ReturnType<typeof readPropertyEvidence>;
type ChartRow = { label: string; value: number; detail?: string };
const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const currency = (value: number | null) =>
  value === null ? 'Not captured' : dollars.format(value);
const positive = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
const estimateRange = (low: unknown, high: unknown, estimate: number | null) =>
  typeof low === 'number' &&
  typeof high === 'number' &&
  estimate !== null &&
  low > 0 &&
  low <= estimate &&
  estimate <= high
    ? `${currency(low)}–${currency(high)}`
    : null;
const dateLabel = (value?: string) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(value))
    : 'Date unavailable';
const sectionStatuses: Record<string, string> = {
  ok: 'Captured',
  partial: 'Partial',
  not_entitled: 'Outside account access',
  not_available: 'No records returned',
  not_found: 'No records returned',
  timed_out: 'Timed out',
  rate_limited: 'Request limited',
  unsupported: 'Unsupported',
  authorization_failed: 'Access unavailable',
  unavailable: 'Unavailable',
};

function ValueBars({ rows, signed = false }: { rows: ChartRow[]; signed?: boolean }) {
  const extent = Math.max(1, ...rows.map((row) => Math.abs(row.value)));
  return (
    <ul className="pbk-investor-bars">
      {rows.map((row, index) => {
        const length = (Math.abs(row.value) / extent) * (signed ? 50 : 100);
        return (
          <li key={`${row.label}-${index}`}>
            <div>
              <span>{row.label}</span>
              <strong>{currency(row.value)}</strong>
            </div>
            {row.detail && <small>{row.detail}</small>}
            <span className="pbk-investor-track" data-signed={signed} aria-hidden="true">
              <span
                data-loss={row.value < 0}
                style={{
                  inlineSize: `${length}%`,
                  insetInlineStart: `${signed ? (row.value < 0 ? 50 - length : 50) : 0}%`,
                }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function HistoryChart({
  title,
  series,
  dateKey,
  amountKey,
  year = false,
}: {
  title: string;
  series?: AttomMcpSection;
  dateKey: string;
  amountKey: string;
  year?: boolean;
}) {
  const rows = (series?.rows ?? [])
    .flatMap((row) => {
      const value = row[amountKey];
      const date = row[dateKey];
      return typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        (year ? typeof date === 'number' : typeof date === 'string')
        ? [{ date: String(date), value }]
        : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-5);
  return (
    <section className="pbk-investor-card">
      <h4>{title}</h4>
      {rows.length ? (
        <ValueBars
          rows={rows.map((row) => ({
            label: year ? row.date : dateLabel(row.date),
            value: row.value,
          }))}
        />
      ) : (
        <p>No dated values available.</p>
      )}
      {series?.retrievedAt && <small>ATTOM · Captured {dateLabel(series.retrievedAt)}</small>}
    </section>
  );
}

function StrategyScenario({
  strategy,
  values,
  setValue,
  clear,
}: {
  strategy: InvestorStrategy;
  values: ScenarioInputs;
  setValue: (key: keyof ScenarioInputs, value: string) => void;
  clear: () => void;
}) {
  const { results, missing, error, sensitivity } = calculateScenario(strategy, values);
  const complete = !missing.length && !error;
  return (
    <section className="pbk-investor-card pbk-investor-calculator" aria-label="Scenario calculator">
      <header>
        <Calculator size={19} aria-hidden />
        <h4>Scenario calculator</h4>
      </header>
      <p>
        Enter your assumptions. Use 0 for a confirmed zero cost. Estimates and saved deal numbers
        stay separate.
      </p>
      <div className="pbk-investor-fields">
        {scenarioFields(strategy).map(({ key, label, max, step }) => (
          <label key={key}>
            <span>{label}</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max={max}
              step={step}
              placeholder="—"
              value={values[key] ?? ''}
              onChange={(event) => setValue(key, event.target.value)}
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        className="pbk-btn pbk-btn-ghost pbk-btn-sm"
        onClick={clear}
        disabled={!Object.values(values).some(Boolean)}
      >
        Clear assumptions
      </button>
      <div className="pbk-investor-outcomes" aria-live="polite">
        {!complete ? (
          <p>{error || `${missing.length} inputs needed for this scenario.`}</p>
        ) : (
          <dl className="pbk-investor-results">
            {results.map((result) => (
              <div key={result.label}>
                <dt>{result.label}</dt>
                <dd data-loss={result.value != null && result.value < 0}>
                  {result.value === null
                    ? 'Not applicable'
                    : result.kind
                      ? `${result.value.toFixed(2)}${result.kind === 'percent' ? '%' : '×'}`
                      : currency(result.value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {complete && sensitivity.length > 0 && (
        <section aria-label="Scenario sensitivity" className="pbk-investor-sensitivity">
          <h5>
            {strategy.model === 'resale'
              ? 'Profit at three resale prices'
              : strategy.model === 'occupancy'
                ? 'Housing cost as rent changes'
                : 'Monthly cash flow as revenue changes'}
          </h5>
          <ValueBars
            rows={sensitivity.flatMap((row) =>
              row.value === null ? [] : [{ label: row.label, value: row.value }]
            )}
            signed
          />
          <small>Only the resale price or gross revenue changes in this comparison.</small>
        </section>
      )}
    </section>
  );
}

export function LeadInvestorWorkspace({
  lead,
  address,
  canSaveScenario,
  evidence,
  sales,
  analyzerLink,
  onOpen,
  onSaved,
}: {
  lead: LeadPortalModel;
  address: AttomPreviewAddress;
  canSaveScenario: boolean;
  evidence: Evidence;
  sales: RecentSalesResult | null;
  analyzerLink: Pick<LinkProps, 'to' | 'state'>;
  onOpen: (tab: 'record' | 'comps' | 'photos') => void;
  onSaved: (leadId: string) => Promise<void>;
}) {
  const [strategyId, setStrategyId] = useState<InvestorStrategy['id']>('fix-flip');
  const [inputs, setInputs] = useState<Partial<Record<InvestorStrategy['id'], ScenarioInputs>>>({});
  const strategy = strategyGuides.find((item) => item.id === strategyId) ?? strategyGuides[0];
  const scenario = inputs[strategy.id] ?? {};
  const { records, listing } = evidence;
  const sections = records?.sections ?? [];
  const section = (id: string) => sections.find((item) => item.id === id);
  const valuation = section('valuation');
  const rental = section('rental-valuation');
  const value = positive(valuation?.facts['valuation.value']);
  const standaloneRent = positive(rental?.facts.value);
  const rent = standaloneRent ?? positive(valuation?.facts['rentalValuation.value']);
  const valueRange = estimateRange(
    valuation?.facts['valuation.valueMin'],
    valuation?.facts['valuation.valueMax'],
    value
  );
  const rentRange = estimateRange(rental?.facts.valueMin, rental?.facts.valueMax, standaloneRent);
  const mortgages = section('mortgage-history');
  const market = section('market-context');
  const localMedian = positive(market?.facts['nearbyContext.medianSalePrice']);
  const zipMedian = positive(market?.facts['zipContext.medianSalePrice']);
  const selectedIds = reviewedCompIds(sales);
  const selectedSales = selectedIds.flatMap((id) =>
    (sales?.sales ?? [])
      .filter((sale) => sale.id === id && positive(sale.price) !== null)
      .slice(0, 1)
  );
  const evidenceVersion = decisionEvidenceVersion({ address, records }, sales, selectedSales);
  const photo = listing?.photoUrls[0];
  const missing = sections.filter((item) => item.status !== 'ok' || item.refreshStatus);
  const setValue = (key: keyof ScenarioInputs, value: string) =>
    setInputs((current) => ({
      ...current,
      [strategy.id]: { ...current[strategy.id], [key]: value },
    }));
  return (
    <div className="pbk-investor-workspace" aria-label="Investor workspace">
      <LeadDealDecisionBrief
        lead={lead}
        address={address}
        canSave={canSaveScenario}
        evidenceVersion={evidenceVersion}
        selectedSales={selectedSales}
        estimate={{ value, rent }}
        estimateDate={{
          value: valuation?.retrievedAt,
          rent: standaloneRent !== null ? rental?.retrievedAt : valuation?.retrievedAt,
        }}
        onOpenComps={() => onOpen('comps')}
        onSaved={onSaved}
      />
      <header className="pbk-investor-hero" data-photo={Boolean(photo)}>
        {photo && (
          <img src={photo} alt="" referrerPolicy="no-referrer" decoding="async" loading="lazy" />
        )}
        <div>
          <BarChart3 size={21} aria-hidden />
          <h3>Investor</h3>
          <p>Review what’s on file, choose an investment strategy, and test the numbers.</p>
          <div className="pbk-investor-actions">
            <Link {...analyzerLink} className="pbk-btn pbk-btn-primary pbk-btn-sm">
              Open Analyzer <ArrowUpRight size={15} aria-hidden />
            </Link>
            <button
              type="button"
              className="pbk-btn pbk-btn-ghost pbk-btn-sm"
              onClick={() => onOpen('record')}
            >
              Property record
            </button>
            {photo && (
              <button
                type="button"
                className="pbk-btn pbk-btn-ghost pbk-btn-sm"
                onClick={() => onOpen('photos')}
              >
                Saved photos
              </button>
            )}
          </div>
          {photo && <small>Saved listing photo · {dateLabel(listing?.retrievedAt)}</small>}
        </div>
      </header>

      <dl className="pbk-investor-stats" aria-label="Saved property and deal figures">
        <div>
          <dt>Saved asking price</dt>
          <dd>{currency(positive(lead.askingPrice))}</dd>
          <small>Lead record</small>
        </div>
        <div>
          <dt>Estimated property value</dt>
          <dd>{currency(value)}</dd>
          <small>ATTOM estimate · {dateLabel(valuation?.retrievedAt)}</small>
          {valueRange && <small>Estimate range {valueRange}</small>}
        </div>
        <div>
          <dt>Estimated monthly rent</dt>
          <dd>{currency(rent)}</dd>
          <small>
            ATTOM estimate ·{' '}
            {dateLabel(standaloneRent !== null ? rental?.retrievedAt : valuation?.retrievedAt)}
          </small>
          {rentRange && <small>Estimate range {rentRange}</small>}
        </div>
        <div>
          <dt>Annual property tax</dt>
          <dd>{currency(records?.facts.taxAmount ?? null)}</dd>
          <small>
            {records?.facts.taxYear ? `ATTOM · Tax year ${records.facts.taxYear}` : 'ATTOM records'}
          </small>
        </div>
      </dl>

      <div className="pbk-investor-workgrid">
        <section
          className="pbk-investor-card pbk-investor-guide"
          aria-label="Investment strategy guide"
        >
          <header>
            <BookOpen size={19} aria-hidden />
            <h4>Investment strategy</h4>
          </header>
          <label className="pbk-investor-select">
            <span>Choose a strategy</span>
            <select
              value={strategy.id}
              onChange={(event) => {
                const chosen = strategyGuides.find((item) => item.id === event.target.value);
                if (chosen) setStrategyId(chosen.id);
              }}
            >
              {strategyGuides.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <h5>{strategy.name}</h5>
          <p>{strategy.summary}</p>
          <dl className="pbk-investor-guide-points">
            <div>
              <dt>Evidence to gather</dt>
              <dd>{strategy.evidence}</dd>
            </div>
            <div>
              <dt>How to underwrite it</dt>
              <dd>{strategy.work}</dd>
            </div>
            <div>
              <dt>Risk to verify</dt>
              <dd>{strategy.risk}</dd>
            </div>
            <div>
              <dt>What to measure</dt>
              <dd>{strategy.measure}</dd>
            </div>
          </dl>
          {'source' in strategy && (
            <a href={strategy.source.url} target="_blank" rel="noreferrer">
              {strategy.source.label} <ArrowUpRight size={14} aria-hidden />
            </a>
          )}
        </section>
        <StrategyScenario
          strategy={strategy}
          values={scenario}
          setValue={setValue}
          clear={() => setInputs((current) => ({ ...current, [strategy.id]: {} }))}
        />
      </div>

      <section aria-label="Saved investment evidence" className="pbk-investor-evidence">
        <header>
          <Layers3 size={19} aria-hidden />
          <h4>Saved investment evidence</h4>
        </header>
        <div className="pbk-investor-chart-grid">
          <section className="pbk-investor-card">
            <h4>Selected comparable sales</h4>
            {selectedSales.length ? (
              <ValueBars
                rows={selectedSales.map((sale) => ({
                  label: sale.address,
                  value: sale.price,
                  detail: [
                    dateLabel(sale.soldDate),
                    positive(sale.sqft) && `${sale.sqft?.toLocaleString()} sq ft`,
                    Number.isFinite(sale.distanceMiles) && `${sale.distanceMiles.toFixed(2)} mi`,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                }))}
              />
            ) : (
              <p>Choose and save comparable sales in the Comps tab to see them here.</p>
            )}
            {sales?.retrievedAt && <small>ATTOM · Captured {dateLabel(sales.retrievedAt)}</small>}
            <button
              type="button"
              className="pbk-btn pbk-btn-ghost pbk-btn-sm"
              onClick={() => onOpen('comps')}
            >
              Open saved comps
            </button>
          </section>
          <HistoryChart
            title="Property value estimate history"
            series={section('valuation-history')}
            dateKey="eventDate"
            amountKey="value"
          />
          <HistoryChart
            title="Recorded property tax by year"
            series={section('tax-history')}
            dateKey="taxYear"
            amountKey="tax"
            year
          />
          <HistoryChart
            title="Recorded property sales"
            series={section('sales-history')}
            dateKey="saleDate"
            amountKey="price"
          />
          <HistoryChart
            title="Original recorded loan amounts"
            series={mortgages}
            dateKey="recordingDate"
            amountKey="originalAmount"
          />
          <section className="pbk-investor-card">
            <h4>Local sale prices</h4>
            {localMedian !== null || zipMedian !== null ? (
              <ValueBars
                rows={[
                  ...(localMedian === null ? [] : [{ label: 'Nearby median', value: localMedian }]),
                  ...(zipMedian === null ? [] : [{ label: 'ZIP code median', value: zipMedian }]),
                ]}
              />
            ) : (
              <p>No local medians saved.</p>
            )}
            {market?.retrievedAt && <small>ATTOM · Captured {dateLabel(market.retrievedAt)}</small>}
          </section>
        </div>
        <div className="pbk-investor-sources pbk-investor-card">
          <h4>Coverage and due diligence</h4>
          {sections.length ? (
            <p>
              {sections.length - missing.length} of {sections.length} saved ATTOM datasets have
              coverage from the latest lookup.
            </p>
          ) : (
            <p>Dataset coverage becomes available after property records are saved.</p>
          )}
          <dl className="pbk-investor-results">
            <div>
              <dt>Saved original mortgage</dt>
              <dd>{currency(records?.facts.originalMortgageAmount ?? null)}</dd>
              <small>Confirm current payoff with the servicer.</small>
            </div>
            <div>
              <dt>Last recorded sale</dt>
              <dd>{currency(records?.facts.recordedSaleAmount ?? null)}</dd>
              <small>{dateLabel(records?.facts.recordedSaleDate ?? undefined)}</small>
            </div>
            <div>
              <dt>Assessed value</dt>
              <dd>{currency(records?.facts.assessedTotalValue ?? null)}</dd>
              <small>Used for tax assessment. Verify with the county.</small>
            </div>
            <div>
              <dt>Recorded unit count</dt>
              <dd>{records?.facts.unitsCount ?? 'Not captured'}</dd>
              <small>Confirm permitted units and current use.</small>
            </div>
            <div>
              <dt>Lot area</dt>
              <dd>
                {records?.facts.lotSqft != null
                  ? `${records.facts.lotSqft.toLocaleString()} sq ft`
                  : 'Not captured'}
              </dd>
              <small>{records?.facts.zoning || 'Zoning not captured'}</small>
            </div>
            <div>
              <dt>Flood map context</dt>
              <dd>{section('fema-context')?.facts['panelContext.zoneCode'] ?? 'Not captured'}</dd>
              <small>Confirm coverage and premium with an insurer.</small>
            </div>
          </dl>
          {!!missing.length && (
            <ul aria-label="Dataset gaps">
              {missing.map((item) => (
                <li key={item.id}>
                  {attomMcpDatasetDefinitions.find((def) => def.id === item.id)?.title} ·{' '}
                  {sectionStatuses[item.refreshStatus?.status ?? item.status]}
                  {item.refreshStatus && ' · Earlier data retained'}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="pbk-btn pbk-btn-ghost pbk-btn-sm"
            onClick={() => onOpen('record')}
          >
            View all saved datasets
          </button>
        </div>
      </section>

      <section className="pbk-investor-card pbk-investor-resources" aria-label="Investor resources">
        <header>
          <ClipboardList size={19} aria-hidden />
          <h4>Investor resources</h4>
        </header>
        <details>
          <summary>Rehab costs</summary>
          <p>
            Walk the property with a contractor. Record quantity, material, labor, permits, and
            contingency for each trade.
          </p>
          <p>
            Start with roof, structure, water damage, electrical, plumbing, HVAC, windows, kitchen,
            baths, and finishes. Track temporary utilities and debris separately, then include the
            total in your scenario.
          </p>
          <p>Saved lead repair estimate · {currency(positive(lead.estimatedRepairs))}</p>
        </details>
        <details>
          <summary>Due diligence templates</summary>
          <h5>Property walk</h5>
          <p>
            Room or system · Condition · Scope and quantities · Contractor quote · Permit check ·
            Contingency
          </p>
          <h5>Rental review</h5>
          <p>
            Unit · Signed rent · Lease end · Deposit · Utilities · Vacancy assumption · Trailing
            expenses · Replacement reserves
          </p>
          <h5>Exit review</h5>
          <p>
            Strategy · Comparable sales and dates · Purchase cost · Required capital · Downside
            outcome · Items to verify before commitment
          </p>
        </details>
        <details>
          <summary>Glossary</summary>
          <dl className="pbk-investor-guide-points">
            {investorGlossary.map(([term, definition]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{definition}</dd>
              </div>
            ))}
          </dl>
        </details>
      </section>
    </div>
  );
}
