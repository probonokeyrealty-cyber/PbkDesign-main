import { useMemo, useRef, useState } from 'react';
import { Bookmark, ClipboardList, ExternalLink, FileText, Search, X } from 'lucide-react';
import {
  COUNTY_CSV_MAX_BYTES,
  COUNTY_DIRECTORY_URL,
  countyStates,
  findCounties,
  getCountySource,
  makeCountyResearchBrief,
  parseCountyParcelCsv,
  searchCountyParcels,
  type Parcel,
} from '../../utils/prospectingCountyData.mjs';
import './ProspectingCountyData.css';

type County = ReturnType<typeof findCounties>['items'][number];
type FileState =
  | { status: 'idle' | 'reading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; filename: string; rows: ReturnType<typeof parseCountyParcelCsv> };
const shortlistLimit = 50;

function ParcelIdentity({ row }: { row: Parcel }) {
  return (
    <div className="pbk-county-parcel-identity">
      <strong>{row.address}</strong>
      <span className="pbk-prospect-id">
        AIN {row.ain}
        {row.rollYear ? ' | Roll ' + row.rollYear : ''}
      </span>
      {row.use && <small>{row.use}</small>}
    </div>
  );
}

function CountyParcelPreview({ county }: { county: County }) {
  const inputId = 'pbk-county-csv';
  const input = useRef<HTMLInputElement>(null);
  const readId = useRef(0);
  const [file, setFile] = useState<FileState>({ status: 'idle' });
  const [query, setQuery] = useState('');
  const [use, setUse] = useState('');
  const [rollYear, setRollYear] = useState('');
  const [shortlist, setShortlist] = useState<Parcel[]>([]);
  const resetReview = () => {
    setQuery('');
    setUse('');
    setRollYear('');
    setShortlist([]);
  };
  const read = async (selected: File) => {
    const id = ++readId.current;
    resetReview();
    if (!/\.csv$/i.test(selected.name) || selected.size > COUNTY_CSV_MAX_BYTES) {
      setFile({ status: 'error', error: 'Choose a CSV extract of 8 MB or less.' });
      return;
    }
    setFile({ status: 'reading' });
    try {
      const text = await selected.text();
      if (id !== readId.current) return;
      setFile({
        status: 'ready',
        filename: selected.name,
        rows: parseCountyParcelCsv(text, county.fips),
      });
    } catch (error) {
      if (id === readId.current)
        setFile({
          status: 'error',
          error: error instanceof Error ? error.message : 'Could not read CSV.',
        });
    }
  };
  const clear = () => {
    ++readId.current;
    if (input.current) {
      input.current.value = '';
      input.current.focus();
    }
    setFile({ status: 'idle' });
    resetReview();
  };
  const options = useMemo(() => {
    if (file.status !== 'ready') return { uses: [], years: [] };
    return {
      uses: [...new Set(file.rows.map((row) => row.use).filter(Boolean))].sort(),
      years: [...new Set(file.rows.map((row) => row.rollYear).filter(Boolean))].sort().reverse(),
    };
  }, [file]);
  const canSearch = query.trim() ? query.trim().length >= 3 : Boolean(use || rollYear);
  const results =
    file.status === 'ready' && canSearch
      ? searchCountyParcels(file.rows, query, { use, rollYear })
      : null;
  const toggleParcel = (row: Parcel) =>
    setShortlist((items) => {
      if (items.some((item) => item.ain === row.ain))
        return items.filter((item) => item.ain !== row.ain);
      return items.length < shortlistLimit ? [...items, row] : items;
    });
  return (
    <section className="pbk-county-preview" aria-labelledby="pbk-county-parcel-heading">
      <header className="pbk-prospect-section-head">
        <h3 id="pbk-county-parcel-heading">
          <FileText size={16} aria-hidden="true" /> Local parcel preview
        </h3>
        <span className="pbk-prospect-id">Unverified CSV</span>
      </header>
      <label className="pbk-county-file" htmlFor={inputId}>
        Assessor CSV extract
        <input
          id={inputId}
          ref={input}
          type="file"
          accept=".csv,text/csv"
          aria-describedby="pbk-county-file-limit"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) void read(selected);
          }}
        />
      </label>
      <small id="pbk-county-file-limit">8 MB / 25,000 rows maximum. Stays in this tab.</small>
      {file.status === 'reading' && <p role="status">Reading CSV...</p>}
      {(file.status === 'error' || file.status === 'ready') && (
        <div className="pbk-prospect-section-head">
          {file.status === 'error' ? (
            <p role="alert" className="pbk-prospect-warning">
              {file.error}
            </p>
          ) : (
            <p role="status">
              {file.filename} · {file.rows.length.toLocaleString()} usable parcel rows
            </p>
          )}
          <button
            type="button"
            className="pbk-prospect-icon"
            onClick={clear}
            title="Clear local file"
            aria-label="Clear local file"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      {file.status === 'ready' && (
        <>
          <div className="pbk-county-criteria">
            <label className="pbk-prospect-search">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label="Search local parcels"
                type="search"
                maxLength={120}
                value={query}
                placeholder="AIN or property address"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {options.uses.length > 0 && (
              <label>
                Property use
                <select value={use} onChange={(event) => setUse(event.target.value)}>
                  <option value="">All uses</option>
                  {options.uses.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
            )}
            {options.years.length > 0 && (
              <label>
                Roll year
                <select value={rollYear} onChange={(event) => setRollYear(event.target.value)}>
                  <option value="">All years</option>
                  {options.years.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="pbk-county-unreviewed">Parcel matches are not contact permission.</p>
          {results && (
            <>
              <p role="status">
                {results.total
                  ? results.total > results.items.length
                    ? 'Showing ' + results.items.length + ' of ' + results.total + ' matches'
                    : results.total + (results.total === 1 ? ' parcel match' : ' parcel matches')
                  : 'No matching parcels.'}
              </p>
              {results.items.length > 0 && (
                <ul className="pbk-county-parcels" aria-label="Local parcel results">
                  {results.items.map((row, index) => {
                    const selected = shortlist.some((item) => item.ain === row.ain);
                    return (
                      <li key={row.ain + ':' + index}>
                        <ParcelIdentity row={row} />
                        <button
                          type="button"
                          className="pbk-prospect-icon"
                          aria-label={'Shortlist AIN ' + row.ain}
                          title="Toggle shortlist"
                          aria-pressed={selected}
                          disabled={!selected && shortlist.length >= shortlistLimit}
                          onClick={() => toggleParcel(row)}
                        >
                          <Bookmark
                            size={17}
                            fill={selected ? 'currentColor' : 'none'}
                            aria-hidden="true"
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
          <section className="pbk-county-shortlist" aria-labelledby="pbk-county-shortlist-heading">
            <header className="pbk-prospect-section-head">
              <h3 id="pbk-county-shortlist-heading">Local shortlist</h3>
              <span role="status">
                {shortlist.length} / {shortlistLimit} parcels
              </span>
            </header>
            {shortlist.length ? (
              <ul className="pbk-county-parcels" aria-label="Shortlisted parcels">
                {shortlist.map((row) => (
                  <li key={row.ain}>
                    <ParcelIdentity row={row} />
                    <button
                      type="button"
                      className="pbk-prospect-icon"
                      aria-label={'Remove AIN ' + row.ain}
                      title="Remove from shortlist"
                      onClick={() => toggleParcel(row)}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <small>No shortlisted parcels.</small>
            )}
          </section>
        </>
      )}
    </section>
  );
}

export function ProspectingCountyData() {
  const [query, setQuery] = useState('Los Angeles County');
  const [state, setState] = useState('');
  const [county, setCounty] = useState<County | null>(() => findCounties('06037').items[0] ?? null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'manual'>('idle');
  const copyId = useRef(0);
  const results = findCounties(query, state);
  const source = county ? getCountySource(county.fips) : null;
  const changeSearch = (nextQuery: string, nextState: string) => {
    setQuery(nextQuery);
    setState(nextState);
    const matches = findCounties(nextQuery, nextState);
    setCounty(matches.total === 1 ? matches.items[0] : null);
    ++copyId.current;
    setCopyStatus('idle');
  };
  const selectCounty = (next: County) => {
    setCounty(next);
    ++copyId.current;
    setCopyStatus('idle');
  };
  const copyBrief = async () => {
    if (!county) return;
    const id = ++copyId.current;
    try {
      await navigator.clipboard.writeText(makeCountyResearchBrief(county));
      if (id === copyId.current) setCopyStatus('copied');
    } catch {
      if (id === copyId.current) setCopyStatus('manual');
    }
  };
  return (
    <section
      id="pbk-county-data"
      className="pbk-prospecting-workspace pbk-county-data"
      aria-label="County data"
    >
      <div className="pbk-prospect-queue">
        <header className="pbk-prospect-section-head">
          <h2>County directory</h2>
          <a
            className="pbk-county-text-link"
            href={COUNTY_DIRECTORY_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Census 2025 <ExternalLink size={12} aria-hidden="true" />
          </a>
        </header>
        <div className="pbk-county-filters">
          <label className="pbk-prospect-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search counties"
              placeholder="County name or FIPS"
              maxLength={96}
              value={query}
              onChange={(event) => changeSearch(event.target.value, state)}
            />
          </label>
          <select
            aria-label="Filter by state or territory"
            value={state}
            onChange={(event) => changeSearch(query, event.target.value)}
          >
            <option value="">All states / territories</option>
            {countyStates.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
        <p role="status">
          {results.total
            ? results.total > results.items.length
              ? 'Showing ' + results.items.length + ' of ' + results.total + ' counties'
              : results.total + (results.total === 1 ? ' county' : ' counties')
            : query.trim().length >= 2 || state
              ? 'No matching counties.'
              : 'Enter a county name or FIPS.'}
        </p>
        {results.items.length > 0 && (
          <ul className="pbk-prospect-rows pbk-county-options" aria-label="Matching counties">
            {results.items.map((item) => (
              <li
                className="pbk-prospect-row"
                key={item.fips}
                data-selected={county?.fips === item.fips}
              >
                <button
                  type="button"
                  className="pbk-prospect-row-choice"
                  aria-pressed={county?.fips === item.fips}
                  onClick={() => selectCounty(item)}
                >
                  <strong>
                    {item.name}, {item.state}
                  </strong>
                  <span className="pbk-prospect-id">FIPS {item.fips}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="pbk-prospect-inspector pbk-county-inspector">
        {county ? (
          <>
            <header className="pbk-prospect-section-head">
              <div>
                <h2>
                  {county.name}, {county.state}
                </h2>
                <span className="pbk-prospect-id">FIPS {county.fips}</span>
              </div>
              <span className="pbk-county-access">Read-only</span>
            </header>
            <div className="pbk-prospect-section-head">
              <h3>County sources</h3>
              <span className={source ? 'pbk-prospect-id' : 'pbk-county-unreviewed'}>
                {source ? 'County-published' : 'Source review required'}
              </span>
            </div>
            {source ? (
              <details className="pbk-county-source-details" open>
                <summary>{source.publisher}</summary>
                <ul className="pbk-county-sources" aria-label="Published county sources">
                  {source.links.map((link) => (
                    <li key={link.href}>
                      <div className="pbk-prospect-section-head">
                        <a
                          className="pbk-county-text-link"
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {link.label} <ExternalLink size={13} aria-hidden="true" />
                        </a>
                        <span className="pbk-prospect-id">{link.type}</span>
                      </div>
                      <small>{link.detail}</small>
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p>No reviewed parcel source. Automated access is off.</p>
            )}
            <div className="pbk-county-brief">
              <button
                type="button"
                className="pbk-prospect-button"
                onClick={() => void copyBrief()}
              >
                <ClipboardList size={15} aria-hidden="true" /> Copy Rex research brief
              </button>
              {copyStatus === 'copied' && <small role="status">Brief copied for Brain.</small>}
              {copyStatus === 'manual' && (
                <label>
                  Rex research brief
                  <textarea
                    readOnly
                    rows={5}
                    value={makeCountyResearchBrief(county)}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
              )}
            </div>
            {source?.localCsv && <CountyParcelPreview key={county.fips} county={county} />}
          </>
        ) : (
          <p>Select a county to review sources.</p>
        )}
      </div>
    </section>
  );
}
