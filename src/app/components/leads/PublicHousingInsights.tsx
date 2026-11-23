import { useId, useState, type FormEvent } from 'react';
import { formatCurrency } from '../../utils/formatting';

export type SurveyEstimate = readonly [estimate: number, marginOfError: number];
export type AnnualIndexChange = readonly [year: number, basisPoints: number];
export type HousingRow = readonly [
  grossRent: SurveyEstimate | null,
  homeValue: SurveyEstimate | null,
  annualHpiChange: AnnualIndexChange | null,
];

const percent = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
});
const signedChange = new Intl.NumberFormat('en-US', {
  style: 'percent',
  signDisplay: 'exceptZero',
  maximumFractionDigits: 2,
});

export const formatIndexChange = (basisPoints: number) => signedChange.format(basisPoints / 10000);

const surveyMetrics = [
  {
    name: 'Median monthly gross rent',
    table: 'B25064',
    definition: 'Rent paid plus applicable utilities and fuels, not a current asking rent.',
  },
  {
    name: 'Median owner-reported home value',
    table: 'B25077',
    definition:
      'Surveyed owner estimates of value, not closed sale prices, appraisals, or asking prices.',
  },
] as const;

function surveyBounds([estimate, margin]: SurveyEstimate) {
  return [Math.max(0, estimate - margin), estimate + margin] as const;
}

export function CensusSnapshotChart({ estimate }: { estimate: SurveyEstimate }) {
  const [low, high] = surveyBounds(estimate);
  const step = 10 ** Math.floor(Math.log10(high)) / 2;
  const max = Math.ceil(high / step) * step;
  const position = (amount: number) => `${(amount / max) * 100}%`;

  return (
    <span className="pbk-market-snapshot-chart">
      <span className="pbk-market-snapshot-axis" aria-hidden="true">
        <span
          className="pbk-market-snapshot-band"
          style={{ insetInlineStart: position(low), width: position(high - low) }}
        />
        <span
          className="pbk-market-snapshot-point"
          style={{ insetInlineStart: position(estimate[0]) }}
        />
      </span>
      <span className="pbk-market-snapshot-scale" aria-hidden="true">
        <span>{formatCurrency(0)}</span>
        <span>{formatCurrency(max)}</span>
      </span>
      <small>
        90% range: {formatCurrency(low)} to {formatCurrency(high)}
      </small>
    </span>
  );
}

export function DescribeIndex({ change }: { change: AnnualIndexChange | null }) {
  if (!change) return <p>No usable annual ZIP5 change was published in this snapshot.</p>;
  const [year, basisPoints] = change;
  const movement = basisPoints > 0 ? 'rose' : basisPoints < 0 ? 'fell' : 'reported no change';
  return (
    <p>
      The FHFA index {movement} in {year} compared with the prior year. This does not describe what
      happened to the saved house or what will happen next.
    </p>
  );
}

export function CensusEstimateDetails({ row }: { row: HousingRow }) {
  return (
    <details className="pbk-market-sources">
      <summary>Read the Census estimates</summary>
      <div className="pbk-market-detail-grid">
        {surveyMetrics.map((metric, index) => {
          const reading = index === 0 ? row[0] : row[1];
          const bounds = reading && surveyBounds(reading);
          return (
            <div key={metric.table}>
              <strong>{metric.name}</strong>
              <p>{metric.definition}</p>
              {reading && bounds ? (
                <p>
                  90% confidence interval:{' '}
                  <strong>
                    {formatCurrency(bounds[0])} to {formatCurrency(bounds[1])}
                  </strong>
                  .{' '}
                  <span>Margin is {percent.format(reading[1] / reading[0])} of the estimate.</span>
                  {reading[1] > reading[0] && ' Lower bound limited to $0.'}
                </p>
              ) : (
                <p>No usable estimate and margin of error for this code.</p>
              )}
              <a
                href={`https://api.census.gov/data/2024/acs/acs5/groups/${metric.table}.html`}
                target="_blank"
                rel="noreferrer"
              >
                Census table {metric.table}
              </a>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function RangeRow({
  zip,
  reading,
  maximum,
}: {
  zip: string;
  reading: SurveyEstimate | null;
  maximum: number;
}) {
  if (!reading)
    return (
      <p>
        <strong>ZCTA {zip}</strong> · No usable survey estimate
      </p>
    );
  const [low, high] = surveyBounds(reading);
  const position = (value: number) => `${(value / maximum) * 100}%`;
  return (
    <div className="pbk-market-range-row">
      <div>
        <strong>ZCTA {zip}</strong>
        <span>{formatCurrency(reading[0])}</span>
        <small>
          {formatCurrency(low)} to {formatCurrency(high)}
        </small>
      </div>
      <div className="pbk-market-range-track" aria-hidden="true">
        <span style={{ insetInlineStart: position(low), width: position(high - low) }} />
        <i style={{ insetInlineStart: position(reading[0]) }} />
      </div>
    </div>
  );
}

function SurveyComparison({
  label,
  zip,
  peer,
  original,
  other,
}: {
  label: string;
  zip: string;
  peer: string;
  original: SurveyEstimate | null;
  other: SurveyEstimate | null;
}) {
  const a = original && surveyBounds(original);
  const b = other && surveyBounds(other);
  const maximum = Math.max(a?.[1] ?? 0, b?.[1] ?? 0, 1);
  const overlap = a && b && a[0] <= b[1] && b[0] <= a[1];
  return (
    <section className="pbk-market-metric" aria-label={label}>
      <h4>{label}</h4>
      <RangeRow zip={zip} reading={original} maximum={maximum} />
      <RangeRow zip={peer} reading={other} maximum={maximum} />
      {a && b ? (
        <small>
          The Census intervals {overlap ? 'overlap' : 'do not overlap'}. This is not a statistical
          significance test.
        </small>
      ) : (
        <small>Both survey estimates are needed to compare intervals.</small>
      )}
    </section>
  );
}

export function ComparePublicHousing({
  zip,
  row,
  lookup,
}: {
  zip: string;
  row: HousingRow;
  lookup: (code: string) => HousingRow | undefined;
}) {
  const fieldId = useId();
  const [entered, setEntered] = useState('');
  const [peer, setPeer] = useState<{ code: string; row: HousingRow } | null>(null);
  const [message, setMessage] = useState('');

  function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = entered.trim();
    const failure = (text: string) => {
      setPeer(null);
      setMessage(text);
    };
    if (!/^[0-9]{5}$/.test(code)) return failure('Enter a five-digit ZIP code.');
    if (code === zip) return failure('Choose a ZIP other than the saved lead ZIP.');
    const match = lookup(code);
    if (!match) return failure(`No public housing observations are available for ${code}.`);
    setPeer({ code, row: match });
    setMessage('');
  }

  return (
    <details className="pbk-market-sources pbk-market-compare">
      <summary>Compare another ZIP</summary>
      <p>
        Use the same Census survey vintage for both codes. Each chart has its own dollar scale. A
        dot marks the estimate and a band shows the 90% confidence interval.
      </p>
      <form className="pbk-market-compare-form" onSubmit={compare}>
        <label htmlFor={fieldId}>Comparison ZIP</label>
        <input
          id={fieldId}
          value={entered}
          onChange={(event) => setEntered(event.target.value)}
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 01001"
        />
        <button type="submit" className="pbk-btn pbk-btn-primary">
          Compare
        </button>
      </form>
      <p className="pbk-market-feedback" role="status">
        {message}
      </p>
      {peer && (
        <section
          aria-label={`Comparison with ${peer.code}`}
          className="pbk-market-comparison-result"
        >
          <div className="pbk-market-summary">
            <SurveyComparison
              label={surveyMetrics[0].name}
              zip={zip}
              peer={peer.code}
              original={row[0]}
              other={peer.row[0]}
            />
            <SurveyComparison
              label={surveyMetrics[1].name}
              zip={zip}
              peer={peer.code}
              original={row[1]}
              other={peer.row[1]}
            />
          </div>
          <section className="pbk-market-metric" aria-label="FHFA annual index comparison">
            <h4>FHFA annual index changes</h4>
            <dl>
              {(
                [
                  [zip, row[2]],
                  [peer.code, peer.row[2]],
                ] as const
              ).map(([code, score]) => (
                <div key={code}>
                  <dt>
                    ZIP {code}
                    {score && ` · ${score[0]}`}
                  </dt>
                  <dd>{score ? formatIndexChange(score[1]) : 'No usable annual change'}</dd>
                </div>
              ))}
            </dl>
            {row[2] && peer.row[2] && row[2][0] !== peer.row[2][0] && (
              <small>Different observation years; not a like-for-like comparison.</small>
            )}
          </section>
        </section>
      )}
    </details>
  );
}
