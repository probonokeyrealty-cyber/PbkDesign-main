import { useEffect, useId, useRef, useState } from 'react';

const areas = [
  { name: 'ZIP', color: 'var(--sky, #82d9f9)', dash: undefined },
  { name: 'County', color: 'var(--text-primary, #d3deea)', dash: '8 5' },
  { name: 'Metro', color: 'var(--text-secondary, #a3bacb)', dash: '2 5' },
];
const metrics = [
  { label: 'Home value', title: 'Typical home value', unit: 'USD', initial: [588, 573, 556], growth: [2.1, 1.25, 1.7], interval: 20, scale: 1_000 },
  { label: 'Inventory change', title: 'Active inventory change', unit: 'Year over year, %', initial: [-4, 1, 3], growth: [.92, .66, .55], interval: 5, scale: 1 },
  { label: 'Price cuts', title: 'Listings with price cuts', unit: 'Share of active listings, %', initial: [13, 17.5, 15.4], growth: [.35, .18, .23], interval: 3, scale: 1 },
];
const ranges = [{ months: 6, label: '6M' }, { months: 12, label: '1Y' }, { months: 24, label: '2Y' }];
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const months = Array.from({ length: 24 }, (_, i) => monthFormat.format(new Date(Date.UTC(2024, i + 10, 1))));
const latest = months.length - 1;
const samples = metrics.map(({ initial, growth, scale, interval }, metric) =>
  months.map((_, month) => areas.map((_, area) => {
    if ((area === 1 && month === 15) || (metric === 1 && area === 2 && month === 20)) return null;
    const swing = Math.sin((month + area * .85) / 2.5) * interval * .4;
    const value = initial[area] + month * growth[area] + swing;
    return Math.round(value * scale * 10) / 10;
  }))
);

function formatValue(value: number | null, metric: number, tick = false) {
  if (value === null) return 'Unavailable';
  if (metric === 0) return tick ? '$' + Math.round(value / 1_000) + 'k' : '$' + Math.round(value).toLocaleString('en-US');
  return (metric === 1 && value > 0 ? '+' : '') + (tick ? Math.round(value) : value.toFixed(1)) + '%';
}

export default function LeadFictionalMarketTrends() {
  const titleId = useId();
  const sliderId = useId();
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(180, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [metric, setMetric] = useState(0);
  const [range, setRange] = useState(months.length);
  const [selected, setSelected] = useState(latest);
  const start = months.length - range;
  const rows = samples[metric].slice(start);
  const values = rows.flat().filter(value => value !== null);
  const { title, unit, interval, scale } = metrics[metric];
  const step = interval * scale;
  const low = Math.floor(Math.min(...values) / step) * step;
  const high = Math.max(low + step, Math.ceil(Math.max(...values) / step) * step);
  const tickStep = high - low > 6 * step ? step * 2 : step;
  const ticks = Array.from({ length: 1 + Math.floor((high - low) / tickStep) }, (_, i) => low + i * tickStep);
  const left = 51;
  const right = width - 14;
  const x = (month: number) => left + (month - start) * (right - left) / (range - 1);
  const y = (value: number) => 184 - (value - low) * 167 / (high - low);
  const chosen = samples[metric][selected];

  return (
    <section className="pbk-market-trends" aria-labelledby={titleId}>
      <header className="pbk-market-section-header">
        <span className="pbk-market-badge pbk-market-badge-example">Fictional market data</span>
        <h4 id={titleId}>Market trends</h4>
        <p>Illustrative single-family trends for a fictional ZIP, county and metro.</p>
      </header>
      <div className="pbk-market-trends-toolbar">
        <div><strong>{title}</strong><small>{unit}</small></div>
        <div role="group" aria-label="Time range">{ranges.map(choice => (
          <button key={choice.months} type="button" aria-pressed={range === choice.months} onClick={() => {
            setRange(choice.months);
            setSelected(current => Math.max(current, months.length - choice.months));
          }}>{choice.label}</button>
        ))}</div>
      </div>
      <div role="group" aria-label="Market metric">{metrics.map(({ label }, index) => (
        <button key={label} type="button" aria-pressed={metric === index} onClick={() => setMetric(index)}>{label}</button>
      ))}</div>
      <div className="pbk-market-trends-readout" aria-live="polite">
        {areas.map(({ name }, area) => <div key={name}>
          <span><i className={'key-' + area} aria-hidden="true" />{name}</span>
          <strong>{formatValue(chosen[area], metric)}</strong>
        </div>)}
      </div>
      <div ref={plot} className="pbk-market-trends-plot" aria-hidden="true" onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const coordinate = (event.clientX - bounds.left) * width / bounds.width;
        const fraction = Math.min(1, Math.max(0, (coordinate - left) / (right - left)));
        setSelected(start + Math.round(fraction * (range - 1)));
      }}>
        <svg viewBox={'0 0 ' + width + ' 212'} preserveAspectRatio="none">
          {ticks.map(value => <g key={value}>
            <line x1={left} x2={right} y1={y(value)} y2={y(value)} className="pbk-market-trends-grid" />
            <text x={left - 6} y={y(value) + 4} textAnchor="end">{formatValue(value, metric, true)}</text>
          </g>)}
          {[start, start + Math.floor((range - 1) / 2), latest].map((month, i) => (
            <text key={month} x={x(month)} y="202" textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{months[month]}</text>
          ))}
          <line x1={x(selected)} x2={x(selected)} y1="17" y2="184" className="pbk-market-trends-cursor" />
          {areas.map(({ name, color, dash }, area) => {
            const path = rows.map((row, i) => {
              const value = row[area];
              if (value === null) return '';
              const command = i === 0 || rows[i - 1][area] === null ? 'M' : 'L';
              return command + x(start + i) + ' ' + y(value);
            }).join(' ');
            const value = chosen[area];
            return <g key={name}>
              <path d={path} fill="none" stroke={color} strokeWidth={area === 0 ? 3 : 1.8}
                strokeDasharray={dash} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {value !== null && <circle cx={x(selected)} cy={y(value)} r="3" fill={color} />}
            </g>;
          })}
        </svg>
      </div>
      <div className="pbk-market-trends-slider">
        <label htmlFor={sliderId}>Inspect month</label>
        <input id={sliderId} type="range" min={start} max={latest} value={selected}
          aria-valuetext={months[selected]} onChange={event => setSelected(Number(event.currentTarget.value))} />
        <output htmlFor={sliderId}>{months[selected]}</output>
      </div>
      <details className="pbk-market-sources">
        <summary>View data table</summary>
        <table>
          <caption>Fictional monthly observations ({unit})</caption>
          <thead><tr><th scope="col">Month</th>{areas.map(({ name }) => <th key={name} scope="col">{name}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => {
            const month = start + index;
            return <tr key={month} aria-current={month === selected ? 'true' : undefined}>
              <th scope="row">{months[month]}</th>
              {row.map((value, area) => <td key={areas[area].name}>{formatValue(value, metric)}</td>)}
            </tr>;
          }).reverse()}</tbody>
        </table>
      </details>
      <footer className="pbk-market-trends-toolbar">
        <small>Gaps show unavailable observations. A live feed requires data permission.</small>
        <a href="https://blog.reventure.app/graph" target="_blank" rel="noopener noreferrer">Reventure research hub ↗</a>
      </footer>
    </section>
  );
}
