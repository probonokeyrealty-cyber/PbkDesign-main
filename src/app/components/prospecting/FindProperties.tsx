import { lazy, Suspense, useCallback, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { bridgeRequest } from '../../utils/runtimeBridge';
import { mapboxPublicToken } from '../../utils/mapboxConfig';
import { matchProspectingParcel, type ProspectingMatch as Match, type ProspectingParcel as Parcel } from '../../utils/prospectingParcelApi';

const ProspectingMap = lazy(() => import('./ProspectingMap'));

type SearchResult = {
  records: Parcel[];
  ranking: 'hermes' | 'building_area';
  retrievedAt: string;
  scanned: number;
  truncated: boolean;
};

type Review = { parcelId: string; match: Match; approvalId?: string; savedLeadId?: string };

function request<T>(
  action: 'search' | 'approval' | 'save',
  body: Record<string, unknown>
) {
  return bridgeRequest<T>({ method: 'POST', path: `/api/prospecting/parcels/${action}`, body });
}

export function FindProperties() {
  const [minimum, setMinimum] = useState('');
  const [singleFamily, setSingleFamily] = useState(true);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const selectPin = useCallback((parcelId: string) => {
    setSelectedPin(parcelId);
    document.getElementById('prospecting-parcel-' + parcelId)?.focus();
  }, []);

  async function run(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prospecting could not complete this request.');
    } finally {
      setBusy('');
    }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run('Searching county records…', async () => {
      setResult(null);
      setReview(null);
      setSelectedPin(null);
      setResult(await request<SearchResult>('search', { minSqft: Number(minimum), singleFamily }));
    });
  }

  function checkMatch(parcelId: string) {
    setSelectedPin(parcelId);
    void run('Checking CRM…', async () => {
      const response = await matchProspectingParcel(parcelId);
      setReview({ parcelId, match: response.match });
    });
  }

  function queueApproval(current: Review) {
    void run('Requesting approval…', async () => {
      const response = await request<{ approvalId?: string; match?: Match }>('approval', {
        parcelId: current.parcelId,
      });
      setReview({
        ...current,
        match: response.match || current.match,
        approvalId: response.approvalId,
      });
    });
  }

  function save(current: Review) {
    void run('Checking approval and saving…', async () => {
      const response = await request<{ leadId: string }>('save', {
        parcelId: current.parcelId,
        approvalId: current.approvalId,
      });
      setReview({ ...current, savedLeadId: response.leadId });
    });
  }

  return (
    <div className="pbk-prospecting-workspace">
      <form onSubmit={search} className="pbk-prospecting-panel pbk-prospecting-form">
        <h2>Van Nuys parcel search</h2>
        <p>
          Search residential parcels whose recorded centers fall inside the certified Van Nuys
          Neighborhood Council boundary.
        </p>
        <label htmlFor="prospect-minimum-area">Minimum building area (sq ft)</label>
        <input
          id="prospect-minimum-area"
          type="number"
          min={0}
          max={20000}
          step={1}
          value={minimum}
          onChange={(event) => setMinimum(event.target.value)}
          placeholder="Any size"
        />
        <label className="pbk-prospecting-check">
          <input
            type="checkbox"
            checked={singleFamily}
            onChange={(event) => setSingleFamily(event.target.checked)}
          />
          Single-family parcels
        </label>
        <p>
          County assessment data. Listing status, asking price, and seller contact are outside this
          source.
        </p>
        <button type="submit" className="pbk-btn pbk-btn-primary" disabled={Boolean(busy)}>
          Find parcels
        </button>
      </form>
      <section
        className="pbk-prospecting-panel pbk-prospecting-result"
        aria-labelledby="prospect-results"
      >
        <h2 id="prospect-results">Property candidates</h2>
        {busy && <p role="status">{busy}</p>}
        {error && (
          <p role="alert" className="pbk-prospecting-error">
            {error}
          </p>
        )}
        {!result && !busy && !error && (
          <p>Run a search to review county records and check CRM matches.</p>
        )}
        {result && (
          <>
            <p>
              {result.ranking === 'hermes'
                ? 'Ranked by Hermes'
                : 'Sorted by recorded building area'}{' '}
              · {result.records.length} shown from {result.scanned} county records checked
              {result.truncated ? ' · Bounded sample' : ''}
            </p>
            <p>
              <a
                className="underline"
                href="https://dpw.gis.lacounty.gov/dpw/rest/services/GIS_Web_Services/MapServer/2"
                target="_blank"
                rel="noreferrer"
              >
                LA County Assessor
              </a>
              {' · Retrieved '}
              <time dateTime={result.retrievedAt}>
                {new Date(result.retrievedAt).toLocaleString()}
              </time>
            </p>
            {result.records.length === 0 && (
              <p>No eligible parcels were found in the records checked.</p>
            )}
            {result.records.some(
              (parcel) => Number.isFinite(parcel.longitude) && Number.isFinite(parcel.latitude)
            ) &&
              (mapboxPublicToken ? (
                <Suspense fallback={<p role="status">Loading parcel map…</p>}>
                  <ProspectingMap
                    token={mapboxPublicToken}
                    parcels={result.records}
                    selectedId={selectedPin}
                    onSelect={selectPin}
                  />
                </Suspense>
              ) : (
                <p>Map preview is unavailable. You can review every parcel in the list below.</p>
              ))}
            <ol className="pbk-prospecting-parcels">
              {result.records.map((parcel, index) => {
                const selected = review?.parcelId === parcel.parcelId ? review : null;
                const leadId = selected?.savedLeadId || selected?.match.leadId;
                return (
                  <li key={parcel.parcelId} data-map-selected={selectedPin === parcel.parcelId}>
                    <h3 id={'prospecting-parcel-' + parcel.parcelId} tabIndex={-1}>
                      {index + 1}. {parcel.line1}
                    </h3>
                    <p>
                      {parcel.city}, CA {parcel.zip} · AIN <code>{parcel.parcelId}</code>
                    </p>
                    <p>
                      {[
                        parcel.use,
                        parcel.sqft
                          ? `${parcel.sqft.toLocaleString()} sq ft`
                          : 'Building area unavailable',
                        parcel.yearBuilt ? `Built ${parcel.yearBuilt}` : null,
                        parcel.rollYear ? `Roll ${parcel.rollYear}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <Link to={'/dialer?vanNuysParcel=' + encodeURIComponent(parcel.parcelId)}
                      aria-label={'Open in Mapbox Dialer, ' + parcel.line1}>
                      Open in Mapbox Dialer
                    </Link>
                    {!selected && (
                      <button
                        type="button"
                        className="pbk-btn pbk-btn-ghost"
                        disabled={Boolean(busy)}
                        aria-label={`Check CRM match for ${parcel.line1}`}
                        onClick={() => checkMatch(parcel.parcelId)}
                      >
                        Check CRM match
                      </button>
                    )}
                    {leadId && (
                      <Link to={`/leads/${encodeURIComponent(leadId)}`}>
                        {selected?.savedLeadId ? 'Open saved lead' : 'Open matching lead'}
                      </Link>
                    )}
                    {selected?.match.status === 'ambiguous' && (
                      <p>Multiple CRM records may match. Review them in Leads.</p>
                    )}
                    {selected?.match.status === 'no_match' && !selected.savedLeadId && (
                      <>
                        <p>
                          No matching lead found. The approval covers the county parcel ID and
                          property address.
                        </p>
                        {selected.approvalId ? (
                          <>
                            <p>
                              Approval ID <code>{selected.approvalId}</code>
                            </p>
                            <Link to="/inbox" target="_blank" rel="noopener">
                              Review in Inbox
                            </Link>
                            <button
                              type="button"
                              className="pbk-btn pbk-btn-primary"
                              disabled={Boolean(busy)}
                              onClick={() => save(selected)}
                            >
                              Save approved lead
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="pbk-btn pbk-btn-ghost"
                            disabled={Boolean(busy)}
                            onClick={() => queueApproval(selected)}
                          >
                            Request lead approval
                          </button>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}
