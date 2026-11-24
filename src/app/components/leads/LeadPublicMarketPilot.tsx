import { useId } from 'react';
import { formatCurrency } from '../../utils/formatting';

const hudRents = [
  ['Studio', 2360],
  ['One bedroom', 2630],
  ['Two bedrooms', 3250],
  ['Three bedrooms', 4120],
  ['Four bedrooms', 4610],
] as const;

const buildingPermits = [
  ['New construction', 1],
  ['Additions', 6],
  ['Alterations and repairs', 29],
] as const;

const totalPermits = buildingPermits.reduce((total, [, count]) => total + count, 0);

export default function LeadPublicMarketPilot() {
  const headingId = useId();

  return (
    <section className="pbk-market-public" aria-labelledby={headingId}>
      <header className="pbk-market-section-header">
        <div className="pbk-market-section-heading">
          <h4 id={headingId}>91411 public-data pilot</h4>
          <a href="https://blog.reventure.app/graph" target="_blank" rel="noopener noreferrer">
            Reventure research hub
          </a>
        </div>
        <p>Staff preview for ZIP 91411. Each source uses its own reporting period.</p>
      </header>

      <div className="pbk-market-summary">
        <section className="pbk-market-metric" aria-label="HUD rent benchmarks">
          <h4>HUD rent benchmarks</h4>
          <p><time dateTime="2026-10">FY 2027</time> · Monthly gross rent</p>
          <dl>
            {hudRents.map(([beds, rent]) => (
              <div key={beds}>
                <dt>{beds}</dt>
                <dd>{formatCurrency(rent)}</dd>
              </div>
            ))}
          </dl>
          <small>Rental assistance benchmark. Verify the property’s lease amount separately.</small>
          <small>
            <a
              href="https://www.huduser.gov/datasets/fmr/fmr2027/summary?mode=safmr&year=2027&reporttype=county&states=6&counties=0603799999"
              target="_blank"
              rel="noopener noreferrer"
            >
              HUD ZIP rent table
            </a>
          </small>
        </section>

        <section className="pbk-market-metric" aria-label="Residential permit activity">
          <h4>Residential permit activity</h4>
          <p><time dateTime="2026-10">October 2026</time> · City of Los Angeles</p>
          <dl>
            <div>
              <dt>One- and two-family building permits issued</dt>
              <dd>{totalPermits}</dd>
            </div>
            {buildingPermits.map(([type, count]) => (
              <div key={type}>
                <dt>{type}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          <small>Counts unique permits for work authorized. Housing units, listings and completed sales use separate measures.</small>
          <small>
            <a
              href="https://data.lacity.org/City-Infrastructure-Service-Requests/Building-and-Safety-Building-Permits-Issued-from-2/pi9x-tg5x"
              target="_blank"
              rel="noopener noreferrer"
            >
              Los Angeles building permit data
            </a>
          </small>
        </section>
      </div>

      <aside className="pbk-market-notice" aria-label="Closed sales and signed leases">
        <strong>Awaiting data rights</strong>
        <p>PBK must confirm display and retention rights before showing closed sales and signed lease amounts.</p>
      </aside>
    </section>
  );
}
