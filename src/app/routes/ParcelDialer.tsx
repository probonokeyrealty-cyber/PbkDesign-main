import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { Loader2, MapPin, Minus, PhoneCall, Plus, RefreshCw, Search } from 'lucide-react';
import {
  decideApproval, dialApprovedRequest, errorText, fetchDialerCoverage, fetchParcels, requestDialerCall, selectParcel,
  simulateDialerCallbacks, type DialerCall, type DialerCoverage, type DialerSelection, type OutboundLine, type ParcelFeature,
} from '../utils/phoneDialerApi';
import '../../styles/phone-dialer.css';

const VIEW_W = 1000;
const VIEW_H = 625;

function outerRings(feature: ParcelFeature): number[][][] {
  return feature.geometry.type === 'Polygon'
    ? [(feature.geometry.coordinates as number[][][])[0]]
    : (feature.geometry.coordinates as number[][][][]).map((poly) => poly[0]);
}

/** Equirectangular projection of the loaded parcels into a fixed SVG viewport. */
function useProjection(features: ParcelFeature[]) {
  return useMemo(() => {
    const pts = features.flatMap((f) => outerRings(f).flat());
    if (!pts.length) return null;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [w, e, s, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const kx = Math.cos(((s + n) / 2) * (Math.PI / 180));
    const spanX = Math.max((e - w) * kx, 1e-9);
    const spanY = Math.max(n - s, 1e-9);
    const scale = Math.min((VIEW_W * 0.92) / spanX, (VIEW_H * 0.92) / spanY);
    const ox = (VIEW_W - spanX * scale) / 2;
    const oy = (VIEW_H - spanY * scale) / 2;
    const project = ([x, y]: number[]) => [ox + (x - w) * kx * scale, VIEW_H - (oy + (y - s) * scale)];
    const pathFor = (f: ParcelFeature) =>
      outerRings(f).map((ring) => ring.map((pt, i) => `${i ? 'L' : 'M'}${project(pt).map((v) => v.toFixed(1)).join(',')}`).join('') + 'Z').join('');
    return { pathFor };
  }, [features]);
}

function coverageTone(status = '') {
  if (status === 'licensed') return 'good';
  if (status === 'fixture') return 'warn';
  return 'bad';
}

export function ParcelDialer() {
  const [coverage, setCoverage] = useState<DialerCoverage | null>(null);
  const [lines, setLines] = useState<OutboundLine[]>([]);
  const [canPlaceCalls, setCanPlaceCalls] = useState(false);
  const [features, setFeatures] = useState<ParcelFeature[]>([]);
  const [lineId, setLineId] = useState('');
  const [selection, setSelection] = useState<DialerSelection | null>(null);
  const [lookup, setLookup] = useState<{ mode: 'parcel' | 'address'; value: string }>({ mode: 'parcel', value: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [request, setRequest] = useState<{ id: string; approvalId: string; toLast4: string; fromLast4: string } | null>(null);
  const [call, setCall] = useState<DialerCall | null>(null);
  const [zoom, setZoom] = useState(1);
  const projection = useProjection(features);

  const load = useCallback(async () => {
    setError('');
    try {
      const [cov, parcels] = await Promise.all([fetchDialerCoverage(), fetchParcels()]);
      setCoverage(cov.coverage);
      setLines(cov.lines);
      setCanPlaceCalls(cov.canPlaceCalls);
      setFeatures(parcels.features);
      setLineId((current) => current || cov.lines.find((l) => l.commissioned && l.callerIdEnabled)?.id || '');
    } catch (err) {
      setError(errorText(err));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Read-only: resolves parcel, exact CRM match and eligibility. Never dials.
  const choose = useCallback(async (input: { parcelId?: string; address?: string }, nextLine = lineId) => {
    setBusy('select');
    setError('');
    setNotice('');
    setRequest(null);
    setCall(null);
    try {
      setSelection(await selectParcel({ ...input, lineId: nextLine }));
    } catch (err) {
      setSelection(null);
      setError(errorText(err));
    } finally {
      setBusy('');
    }
  }, [lineId]);

  const selectedId = selection?.parcel.properties.parcelId || '';
  const reselect = (nextLine = lineId) => selectedId && choose({ parcelId: selectedId }, nextLine);

  const onPolygonKey = (event: KeyboardEvent<SVGPathElement>, parcelId: string) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void choose({ parcelId }); }
  };

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError('');
    try { await fn(); } catch (err) { setError(errorText(err)); } finally { setBusy(''); }
  };

  const viewBox = useMemo(() => {
    const w = VIEW_W / zoom;
    const h = VIEW_H / zoom;
    return `${(VIEW_W - w) / 2} ${(VIEW_H - h) / 2} ${w} ${h}`;
  }, [zoom]);

  const situs = selection?.parcel.properties.situs;
  const contact = selection?.contact;

  return (
    <div className="pbk-dialer pbk-dialer-surface">
      <header className="pbk-dialer-head">
        <div>
          <span className="pbk-kicker">Parcel dialer</span>
          <h1>Dial by <em>parcel</em>.</h1>
        </div>
        <div className="pbk-dialer-coverage" aria-live="polite">
          {coverage ? (
            <>
              <span className={`pbk-phone-tag ${coverageTone(coverage.status)}`}>{coverage.status === 'fixture' ? 'fixture parcels · not licensed' : coverage.status}</span>
              <span>{coverage.source || 'No parcel source'}</span>
              {coverage.mock && <span className="pbk-phone-mode" data-mode="mock">mock providers</span>}
            </>
          ) : <Loader2 size={14} className="animate-spin" />}
          <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => void load()} aria-label="Refresh dialer"><RefreshCw size={13} /></button>
        </div>
      </header>

      {coverage?.note && <p className="pbk-phone-note">{coverage.note}</p>}
      {error && <div className="pbk-phone-error" role="alert">{error}</div>}

      <div className="pbk-dialer-grid">
        <section className="pbk-dialer-map-card" aria-label="Parcel map">
          <form className="pbk-phone-form" onSubmit={(e) => { e.preventDefault(); if (lookup.value.trim()) void choose(lookup.mode === 'parcel' ? { parcelId: lookup.value.trim() } : { address: lookup.value.trim() }); }}>
            <label>Lookup<select className="pbk-input" value={lookup.mode} onChange={(e) => setLookup({ mode: e.target.value as 'parcel' | 'address', value: '' })}><option value="parcel">Parcel ID</option><option value="address">Address</option></select></label>
            <label style={{ flex: '1 1 220px' }}>{lookup.mode === 'parcel' ? 'Parcel ID' : 'Street, city, ST ZIP'}<input className="pbk-input" value={lookup.value} onChange={(e) => setLookup((l) => ({ ...l, value: e.target.value }))} /></label>
            <button type="submit" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={busy === 'select'}><Search size={13} /> Find</button>
          </form>
          <div className="pbk-dialer-map">
            {projection && features.length ? (
              <>
                <svg viewBox={viewBox} role="group" aria-label={`${features.length} parcels. Select one to view its contact; selection never places a call.`}>
                  {features.map((f) => (
                    <path
                      key={f.properties.parcelId}
                      d={projection.pathFor(f)}
                      data-selected={f.properties.parcelId === selectedId}
                      tabIndex={0}
                      role="button"
                      aria-label={`Parcel ${f.properties.parcelId}, ${f.properties.situs.line1}`}
                      onClick={() => void choose({ parcelId: f.properties.parcelId })}
                      onKeyDown={(e) => onPolygonKey(e, f.properties.parcelId)}
                    >
                      <title>{`${f.properties.parcelId} · ${f.properties.situs.line1}`}</title>
                    </path>
                  ))}
                </svg>
                <div className="pbk-dialer-map-tools">
                  <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => setZoom((z) => Math.min(z * 1.5, 6))} aria-label="Zoom in"><Plus size={13} /></button>
                  <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => setZoom((z) => Math.max(z / 1.5, 1))} aria-label="Zoom out"><Minus size={13} /></button>
                </div>
              </>
            ) : (
              <div className="pbk-dialer-map-empty">{coverage?.status === 'unconfigured' ? 'No licensed parcel source is configured. Lookups are unavailable.' : coverage ? 'No parcels in coverage.' : 'Loading parcels…'}</div>
            )}
          </div>
          <div className="pbk-dialer-legend">{features.length} parcels · click or Enter selects · selection never dials</div>
        </section>

        <aside className="pbk-dialer-side" aria-label="Selected parcel">
          <label>Outbound Twilio line
            <select className="pbk-input" value={lineId} onChange={(e) => { setLineId(e.target.value); void reselect(e.target.value); }}>
              <option value="">Choose a line</option>
              {lines.map((l) => <option key={l.id} value={l.id} disabled={!l.commissioned || !l.callerIdEnabled}>{l.display}{!l.commissioned ? ' · not commissioned' : !l.callerIdEnabled ? ' · caller ID off' : ''}</option>)}
            </select>
          </label>
          {!lines.some((l) => l.commissioned && l.callerIdEnabled) && (
            <p className="pbk-phone-note">No commissioned Twilio line yet. Commission one in <Link to="/settings">Settings → Phone numbers</Link>.</p>
          )}

          {busy === 'select' && <div className="pbk-phone-note"><Loader2 size={13} className="animate-spin" /> Matching parcel…</div>}
          {!selection && busy !== 'select' && <div className="pbk-phone-note"><MapPin size={13} /> Select a parcel on the map or look one up.</div>}

          {selection && situs && (
            <div className="pbk-dialer-contact">
              <span className="pbk-kicker">{selection.parcel.properties.parcelId}</span>
              <h2>{contact ? contact.name : situs.line1}</h2>
              <dl className="pbk-dialer-kv">
                <dt>Situs</dt><dd>{situs.line1}, {situs.city}, {situs.state} {situs.zip}</dd>
                <dt>CRM match</dt>
                <dd>
                  {selection.match.status === 'matched' && <span className="pbk-phone-tag good">exact · {selection.match.matchedOn.replace('_', ' ')}</span>}
                  {selection.match.status === 'ambiguous' && <span className="pbk-phone-tag bad">{selection.match.candidateCount} contacts · rejected</span>}
                  {selection.match.status === 'no_match' && <span className="pbk-phone-tag">no CRM contact</span>}
                </dd>
                {contact && (<>
                  <dt>Phone</dt><dd className="pbk-phone-num">{contact.phoneDisplay || 'none'}</dd>
                  <dt>Status</dt><dd>{contact.status || '—'}{contact.synthetic ? ' · synthetic' : ''}</dd>
                  <dt>Lead</dt><dd>{contact.synthetic ? contact.id : <Link to={`/leads/${encodeURIComponent(contact.id)}`}>{contact.id}</Link>}</dd>
                </>)}
              </dl>
            </div>
          )}

          {selection?.contact && (
            <div>
              <div className="pbk-phone-subhead">Activity</div>
              <div className="pbk-dialer-activity">
                {selection.activity.length ? selection.activity.map((a) => (
                  <div key={a.id}><span>{new Date(a.at).toLocaleString()}</span><span>{a.outcome || a.status}{a.talkSeconds != null ? ` · ${a.talkSeconds}s talk` : ''}</span></div>
                )) : <span className="pbk-phone-note">No dialer calls yet.</span>}
              </div>
            </div>
          )}

          {selection && (
            <div className="pbk-dialer-callbox">
              <div className="pbk-phone-subhead">Dial eligibility</div>
              {selection.eligibility.eligible
                ? <span className="pbk-phone-ok">Eligible for one manual call.</span>
                : <ul className="pbk-dialer-reasons">{selection.eligibility.reasons.map((r) => <li key={r.code}>{r.message}</li>)}</ul>}

              {selection.eligibility.eligible && !request && canPlaceCalls && contact && (
                <button type="button" className="pbk-btn pbk-btn-primary pbk-btn-sm" disabled={Boolean(busy)}
                  onClick={() => act('request', async () => {
                    const r = await requestDialerCall({ parcelId: selectedId, leadId: contact.id, lineId });
                    setRequest({ id: r.request.id, approvalId: r.approvalId, toLast4: r.request.toLast4, fromLast4: r.request.fromLast4 });
                    setNotice('Call approval queued. Dial once it is approved.');
                  })}>
                  <PhoneCall size={13} /> Request call approval
                </button>
              )}

              {request && !call && (
                <div className="pbk-phone-confirm">
                  <span className="pbk-phone-note">One call to the contact ending <strong>{request.toLast4}</strong> from line ending <strong>{request.fromLast4}</strong>. Your phone rings first, then PBK bridges the contact.</span>
                  <div className="pbk-phone-actions">
                    {coverage?.mock
                      ? <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={Boolean(busy)} onClick={() => act('approve', async () => { await decideApproval(request.approvalId, 'approve'); setNotice('Dev approval recorded.'); })}>Approve (dev)</button>
                      : <Link className="pbk-btn pbk-btn-ghost pbk-btn-sm" to="/inbox">Open approval queue</Link>}
                    <button type="button" className="pbk-btn pbk-btn-primary pbk-btn-sm" disabled={Boolean(busy)}
                      onClick={() => act('dial', async () => { const r = await dialApprovedRequest(request.id); setCall(r.call); setNotice('Call placed. Outcome arrives from signed carrier callbacks.'); })}>
                      <PhoneCall size={13} /> Dial approved call
                    </button>
                  </div>
                </div>
              )}

              {call && (
                <div className="pbk-phone-confirm">
                  <span className="pbk-phone-note">Call {call.status.replace(/_/g, ' ')}{call.outcome ? ` · ${call.outcome}` : ''}{call.talkSeconds != null ? ` · ${call.talkSeconds}s talk` : ''}</span>
                  {coverage?.mock && !call.finalizedAt && (
                    <div className="pbk-phone-actions">
                      {(['connected', 'no-answer', 'busy'] as const).map((outcome) => (
                        <button key={outcome} type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={Boolean(busy)}
                          onClick={() => act('sim', async () => { const r = await simulateDialerCallbacks(call.id, outcome, 42); await reselect(); setCall(r.call); })}>
                          Simulate {outcome}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {notice && <div className="pbk-phone-ok" role="status">{notice}</div>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
