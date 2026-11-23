import { formatCurrency } from '../../utils/formatting';
import snapshot from '../../data/public-zip-housing.json?raw';
import {
  CensusEstimateDetails,
  ComparePublicHousing,
  DescribeIndex,
  formatIndexChange,
  type HousingRow,
  type SurveyEstimate,
} from './PublicHousingInsights';

const housingByCode: Partial<Record<string, HousingRow>> = JSON.parse(snapshot);

function SurveyEstimateLabel({ estimate }: { estimate: SurveyEstimate | null }) {
  if (!estimate) return <>Unavailable</>;
  return (
    <>
      <span>{formatCurrency(estimate[0])}</span>
      <small>90% margin of error: {formatCurrency(estimate[1])}</small>
    </>
  );
}

export default function LeadPublicHousingContext({ zip }: { zip: string }) {
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
          They are not current listings, comparable sales, or a valuation.
        </p>
      </header>
      <div className="pbk-market-summary">
        <section className="pbk-market-metric" aria-label="Census survey">
          <h4>Census ZCTA {zip}</h4>
          <p>
            ACS 2020-2024 five-year survey. Matched by five-digit code; a Census ZCTA is not a
            postal ZIP.
          </p>
          <dl>
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
      <ComparePublicHousing key={zip} zip={zip} row={row} lookup={(code) => housingByCode[code]} />
      <CensusEstimateDetails row={row} />
    </section>
  );
}
