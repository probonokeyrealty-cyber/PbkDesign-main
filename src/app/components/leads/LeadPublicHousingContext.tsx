import { formatCurrency } from '../../utils/formatting';
import snapshot from '../../data/public-zip-housing.json?raw';
import {
  CensusEstimateDetails,
  CensusSnapshotChart,
  ComparePublicHousing,
  DescribeIndex,
  formatIndexChange,
  type HousingRow,
  type SurveyEstimate,
} from './PublicHousingInsights';

const housingByCode: Partial<Record<string, HousingRow>> = JSON.parse(snapshot);
const stagingZcta = '91411';
const stagingIncome: SurveyEstimate = [74617, 6476];
const stagingUnemployment = { rate: 5, month: '2025-12', label: 'December 2025' };

function SurveyEstimateLabel({ estimate }: { estimate: SurveyEstimate | null }) {
  if (!estimate) return <>Unavailable</>;
  return (
    <>
      <span>{formatCurrency(estimate[0])}</span>
      <small>90% margin of error: {formatCurrency(estimate[1])}</small>
      <CensusSnapshotChart estimate={estimate} />
    </>
  );
}

function StagingMarketIndicators() {
  const { rate, month, label } = stagingUnemployment;
  return (
    <section aria-label="Staging market indicators" className="pbk-market-summary">
      <section className="pbk-market-metric" aria-label="Census ZCTA 91411 income">
        <span className="pbk-market-badge">ZIP context · Census ZCTA {stagingZcta}</span>
        <h4>Median annual household income</h4>
        <p>
          ACS 2020-2024 five-year estimate, in 2024 dollars. ZCTA is a Census geography, not a
          postal ZIP.
        </p>
        <dl className="pbk-market-census-charts">
          <div>
            <dt>Household income estimate</dt>
            <dd>
              <SurveyEstimateLabel estimate={stagingIncome} />
            </dd>
          </div>
        </dl>
        <small>
          <a
            href="https://api.census.gov/data/2024/acs/acs5/groups/B19013.html"
            target="_blank"
            rel="noreferrer"
          >
            U.S. Census Bureau · B19013
          </a>
        </small>
      </section>
      <section className="pbk-market-metric" aria-label="Los Angeles County unemployment">
        <span className="pbk-market-badge">County context · FIPS 06037</span>
        <h4>Los Angeles County unemployment</h4>
        <p>
          <time dateTime={month}>{label}</time> · Not seasonally adjusted
        </p>
        <dl className="pbk-market-census-charts">
          <div>
            <dt>Monthly unemployment rate</dt>
            <dd>
              <span>{rate.toFixed(1)}%</span>
              <meter
                className="pbk-market-rate-meter"
                aria-label="County unemployment rate"
                aria-valuetext={`${rate.toFixed(1)} percent`}
                min={0}
                max={100}
                value={rate}
              />
              <span className="pbk-market-snapshot-scale" aria-hidden="true">
                <span>0%</span>
                <span>100%</span>
              </span>
            </dd>
          </div>
        </dl>
        <p>This county is shown as a staging reference, not a ZIP or property-level rate.</p>
        <small>
          <a href="https://www.bls.gov/lau/" target="_blank" rel="noreferrer">
            U.S. Bureau of Labor Statistics · LAUS
          </a>
        </small>
      </section>
    </section>
  );
}

export default function LeadPublicHousingContext({
  zip,
  savedAsk,
}: {
  zip: string;
  savedAsk: { amount: number; capturedAt: string; date: string } | null;
}) {
  const row: HousingRow = housingByCode[zip] ?? [null, null, null];
  const [grossRent, homeValue, hpiChange] = row;
  const available = row.filter((value) => value !== null).length;
  return (
    <section aria-label="Public housing context" className="pbk-market-public">
      <header className="pbk-market-section-header">
        <div className="pbk-market-section-heading">
          <div>
            <span className="pbk-market-badge">Public data snapshot</span>
            <h4>Public housing context</h4>
          </div>
          <strong className="pbk-market-availability">{available} of 3 measures available</strong>
        </div>
        <p>
          These area statistics are separate from the saved house facts and fictional benchmarks.
          This is a survey snapshot, not a trend or an appraisal.
        </p>
      </header>
      <aside aria-label="Saved listing reference" className="pbk-market-house-reference">
        <div>
          <span className="pbk-market-badge">Saved property</span>
          <strong>Listing asking price</strong>
        </div>
        <div>
          {savedAsk ? (
            <>
              <strong>{formatCurrency(savedAsk.amount)}</strong>
              <small>
                Captured <time dateTime={savedAsk.capturedAt}>{savedAsk.date}</time>
              </small>
            </>
          ) : (
            <strong>Not captured</strong>
          )}
        </div>
        <small>Listing evidence only. Not plotted against the Census home-value estimate.</small>
      </aside>
      <div className="pbk-market-summary pbk-market-source-grid">
        <section className="pbk-market-metric" aria-label="Census survey">
          <h4>Census ZCTA {zip}</h4>
          <p>
            ACS 2020-2024 five-year survey. Matched by five-digit code; a Census ZCTA is not a
            postal ZIP.
          </p>
          <p className="pbk-market-chart-key">Hollow dot: estimate. Band: 90% confidence range.</p>
          <dl className="pbk-market-census-charts">
            <div>
              <dt>Median monthly gross rent</dt>
              <dd>
                <SurveyEstimateLabel estimate={grossRent} />
              </dd>
            </div>
            <div>
              <dt>Median owner-reported home value</dt>
              <dd>
                <SurveyEstimateLabel estimate={homeValue} />
              </dd>
            </div>
          </dl>
          <small>
            <a
              href="https://www.census.gov/programs-surveys/acs/data/summary-file.2024.html"
              target="_blank"
              rel="noreferrer"
            >
              U.S. Census Bureau
            </a>{' '}
            · B25064 and B25077. Unreported or open-ended estimates are withheld.
          </small>
        </section>
        <section className="pbk-market-metric" aria-label="FHFA price index">
          <h4>FHFA ZIP {zip}</h4>
          <dl>
            <div>
              <dt>Annual house price index change{hpiChange && ` (${hpiChange[0]})`}</dt>
              <dd>{hpiChange ? formatIndexChange(hpiChange[1]) : 'Unavailable'}</dd>
            </div>
          </dl>
          <p>
            Developmental all-transactions index. Measures area price change, not a price or dollar
            estimate.
          </p>
          <DescribeIndex change={hpiChange} />
          <small>
            <a
              href="https://www.fhfa.gov/data/hpi/datasets?data=annual-house-price-indexes-zip5"
              target="_blank"
              rel="noreferrer"
            >
              FHFA ZIP5 House Price Index
            </a>{' '}
            · March 31, 2026 release.
          </small>
          <small>This product uses FHFA data but is neither endorsed nor certified by FHFA.</small>
        </section>
      </div>
      {import.meta.env.PBK_MARKET_STAGING_INDICATORS && zip === stagingZcta && (
        <StagingMarketIndicators />
      )}
      <ComparePublicHousing key={zip} zip={zip} row={row} lookup={(code) => housingByCode[code]} />
      <CensusEstimateDetails row={row} />
    </section>
  );
}
