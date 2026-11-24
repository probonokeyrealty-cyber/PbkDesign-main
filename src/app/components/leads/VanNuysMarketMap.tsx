import { useState } from 'react';
import type { FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import { formatCurrency } from '../../utils/formatting';
import boundaries from '../../data/van-nuys-market-boundaries.json';
import { LA_COUNTY_UNEMPLOYMENT, VAN_NUYS_ZCTA } from './marketStagingData';
import type { HousingRow, SurveyEstimate } from './PublicHousingInsights';

type BoundaryCollection = FeatureCollection<
  Polygon | MultiPolygon,
  {
    code: string;
    labelPoint: [number, number];
  }
>;
const { zcta, county } = boundaries as Record<'zcta' | 'county', BoundaryCollection>;
const width = 340;
const height = 235;
const palette = ['#d6eaf2', '#80c2d4', '#2b91ae', '#00617f'] as const;
const noData = '#56606c';
const metrics = {
  rent: { field: 0, label: 'Median monthly gross rent', cuts: [1800, 2000, 2300] },
  value: { field: 1, label: 'Median owner-reported home value', cuts: [800000, 1000000, 1300000] },
} as const;
type Metric = keyof typeof metrics;
type Layer = Metric | 'county';
type Lookup = (code: string) => HousingRow | undefined;

function project([lon, lat]: Position): [number, number] {
  return [lon, -Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * (180 / Math.PI)];
}

function fitBoundaries(collection: BoundaryCollection) {
  const features = collection.features.map(({ geometry, properties }) => ({
    ...properties,
    rings: (geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat()).map(
      (ring) => ring.map(project)
    ),
  }));
  const points = features.flatMap(({ rings }) => rings.flat());
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs),
    right = Math.max(...xs);
  const top = Math.min(...ys),
    bottom = Math.max(...ys);
  const scale = Math.min((width - 32) / (right - left), (height - 28) / (bottom - top));
  const fit = ([x, y]: [number, number]) =>
    [
      ((x - (left + right) / 2) * scale + width / 2).toFixed(2),
      ((y - (top + bottom) / 2) * scale + height / 2).toFixed(2),
    ] as const;
  return features.map(({ code, rings, labelPoint }) => ({
    code,
    path: rings.map((ring) => `M${ring.map((point) => fit(point).join(',')).join('L')}Z`).join(''),
    label: fit(project(labelPoint)),
  }));
}

const zctaShapes = fitBoundaries(zcta);
const countyShapes = fitBoundaries(county);

function getEstimate(lookup: Lookup, code: string, metric: Metric) {
  return lookup(code)?.[metrics[metric].field] ?? null;
}

function estimateColor(estimate: SurveyEstimate | null, metric: Metric) {
  return estimate
    ? palette[metrics[metric].cuts.filter((cut) => estimate[0] >= cut).length]
    : noData;
}

function Readout({ code, metric, lookup }: { code: string; metric: Metric; lookup: Lookup }) {
  const estimate = getEstimate(lookup, code, metric);
  return (
    <p className="pbk-market-map-reading">
      <strong>Census ZCTA {code}</strong>
      {estimate ? (
        <>
          <span>{formatCurrency(estimate[0])}</span>
          <small>
            90% confidence range: {formatCurrency(Math.max(0, estimate[0] - estimate[1]))}
            {' to '}
            {formatCurrency(estimate[0] + estimate[1])}
          </small>
        </>
      ) : (
        <span>No published estimate for this metric.</span>
      )}
    </p>
  );
}

function Legend({ metric }: { metric: Metric }) {
  const [low, middle, high] = metrics[metric].cuts.map(formatCurrency);
  const labels = [
    `Under ${low}`,
    `${low} to <${middle}`,
    `${middle} to <${high}`,
    `${high} and up`,
    'Unavailable',
  ];
  return (
    <ul className="pbk-market-map-legend" aria-label="Map legend">
      {labels.map((label, index) => (
        <li key={label}>
          <span aria-hidden="true" style={{ backgroundColor: palette[index] ?? noData }} />
          {label}
        </li>
      ))}
    </ul>
  );
}

export default function VanNuysMarketMap({
  lookup,
  selected,
  onSelect,
  onViewComparison,
}: {
  lookup: Lookup;
  selected: string;
  onSelect: (code: string) => void;
  onViewComparison: () => void;
}) {
  const [layer, setLayer] = useState<Layer>('rent');
  const [hovered, setHovered] = useState('');
  const isCounty = layer === 'county';
  const readCode =
    hovered || (zctaShapes.some(({ code }) => code === selected) ? selected : VAN_NUYS_ZCTA);
  const { rate, month, label, fips, name } = LA_COUNTY_UNEMPLOYMENT;
  return (
    <section className="pbk-market-map" aria-label="Van Nuys market map">
      <header className="pbk-market-section-header">
        <span className="pbk-market-badge">Van Nuys pilot · Read-only</span>
        <h4>Market Map</h4>
        <p>Tap a Census area on the map or choose one from the list. Your saved house stays pinned.</p>
      </header>
      <div className="pbk-market-map-layers" role="group" aria-label="Map layer">
        {(
          [
            ['rent', 'Gross rent'],
            ['value', 'Home value'],
            ['county', 'County unemployment'],
          ] as const
        ).map(([key, text]) => (
          <button
            key={key}
            type="button"
            aria-pressed={layer === key}
            onClick={() => {
              setHovered('');
              setLayer(key);
            }}
          >
            {text}
          </button>
        ))}
      </div>
      <svg
        className="pbk-market-map-canvas"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={isCounty ? 'Los Angeles County boundary' : 'Van Nuys market boundaries'}
      >
        {isCounty ? (
          countyShapes.map(({ code, path }) => (
            <path key={code} d={path} fill="#478686" stroke="#b0dfd7" fillRule="evenodd" />
          ))
        ) : (
          <>
            {zctaShapes.map(({ code, path }) => (
              <path
                key={code}
                data-area-code={code}
                className={code === VAN_NUYS_ZCTA ? undefined : 'pbk-market-map-area-shape'}
                d={path}
                fill={estimateColor(getEstimate(lookup, code, layer), layer)}
                fillRule="evenodd"
                opacity={hovered && hovered !== code ? 0.72 : 1}
                stroke="#101d29"
                strokeWidth={1.2}
                onPointerEnter={() => setHovered(code)}
                onPointerLeave={() => setHovered('')}
                onClick={() => {
                  if (code !== VAN_NUYS_ZCTA) onSelect(code);
                }}
              />
            ))}
            {zctaShapes
              .filter(({ code }) => code === VAN_NUYS_ZCTA || code === selected)
              .map(({ code, path }) => (
                <path
                  key={code}
                  d={path}
                  fill="none"
                  stroke={code === VAN_NUYS_ZCTA ? '#fff1ca' : '#a7f5f1'}
                  strokeWidth={2.5}
                  strokeDasharray={code === VAN_NUYS_ZCTA ? undefined : '4 2'}
                  pointerEvents="none"
                />
              ))}
            {zctaShapes.map(({ code, label: [x, y] }) => (
              <text
                className="pbk-market-map-label"
                key={code}
                data-zcta={code}
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                pointerEvents="none"
              >
                {code}
              </text>
            ))}
          </>
        )}
      </svg>
      <div className="pbk-market-map-selection">
        <div role="status" aria-label="Map selection" aria-atomic="true">
          <dl>
            <div>
              <dt>Saved lead area</dt>
              <dd>ZCTA {VAN_NUYS_ZCTA}</dd>
            </div>
            <div>
              <dt>Comparison area</dt>
              <dd>{selected ? `ZCTA ${selected}` : 'None selected'}</dd>
            </div>
          </dl>
        </div>
        {selected && (
          <button type="button" onClick={onViewComparison}>
            View comparison <span aria-hidden="true">↓</span>
          </button>
        )}
      </div>
      {isCounty ? (
        <div className="pbk-market-map-caption">
          <strong>
            {name} · FIPS {fips}
          </strong>
          <p>
            {rate.toFixed(1)}% · <time dateTime={month}>{label}</time>
          </p>
          <small>
            BLS LAUS, not seasonally adjusted. County reference only, not a ZIP or house measure.
          </small>
        </div>
      ) : (
        <div className="pbk-market-map-caption">
          <strong>{metrics[layer].label}</strong>
          <Legend metric={layer} />
          <small>
            Solid outline: saved lead area. Dashed outline: comparison area when shown on the map.
          </small>
          <Readout code={readCode} metric={layer} lookup={lookup} />
          <div className="pbk-market-map-areas" role="group" aria-label="Compare areas">
            {zctaShapes
              .filter(({ code }) => code !== VAN_NUYS_ZCTA)
              .map(({ code }) => {
                const reading = getEstimate(lookup, code, layer);
                return (
                  <button
                    key={code}
                    type="button"
                    aria-pressed={selected === code}
                    onClick={() => onSelect(code)}
                  >
                    <span>Compare ZCTA {code}</span>
                    <small>{reading ? formatCurrency(reading[0]) : 'Unavailable'}</small>
                  </button>
                );
              })}
          </div>
        </div>
      )}
      <small className="pbk-market-map-credit">
        <a
          href="https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html"
          target="_blank"
          rel="noreferrer"
        >
          U.S. Census Bureau TIGERweb 2020 boundaries
        </a>
        {' · '}Simplified for display. ZCTAs are not postal or parcel boundaries. Housing estimates:
        ACS 2020-2024.
      </small>
    </section>
  );
}
