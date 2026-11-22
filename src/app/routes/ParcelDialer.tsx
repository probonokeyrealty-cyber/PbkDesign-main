import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { ArrowDownRight, Check, ClipboardList, Layers, ListChecks, Loader2, MapPin, Minus, PhoneCall, Plus, RefreshCw, Search } from 'lucide-react';
import { ParcelProspectingBrief } from '../components/ParcelProspectingBrief';
import { ParcelProspectingList } from '../components/ParcelProspectingList';
import { SavedEvidenceMark } from '../components/SavedEvidenceMark';
import { mapboxPublicToken } from '../utils/mapboxConfig';
import {
  getProspectingParcelApprovalStatus, matchProspectingParcel, requestProspectingParcelApproval,
  saveApprovedProspectingParcel, type ProspectingApprovalStatus, type ProspectingMatch, type ProspectingParcel,
} from '../utils/prospectingParcelApi';
import { parcelProspect, prospectLimit, readParcelProspects, saveParcelProspects, type ParcelProspect } from '../utils/parcelProspecting';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ParcelPhoneKeypad } from '../components/ParcelPhoneKeypad';
import {
  createLeadFromParcel, decideApproval, dialApprovedRequest, errorText, fetchDialerCalls, fetchDialerCoverage, fetchParcels, prepareParcelBrief, requestDialerCall, selectParcel,
  simulateDialerCallbacks, type DialerCall, type DialerCoverage, type DialerSelection, type OutboundLine, type ParcelBrief, type ParcelFeature,
} from '../utils/phoneDialerApi';
import '../../styles/phone-dialer.css';

type DialerPanel = 'parcel' | 'brief' | 'shortlist';
const ParcelStreetMap = lazy(() => import('../components/ParcelStreetMap').then(({ ParcelStreetMap }) => ({ default: ParcelStreetMap })));

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
  const { search } = useLocation();
  const parcelId = new URLSearchParams(search).get('vanNuysParcel');
  return parcelId === null ? <RegularParcelDialer /> : <VanNuysParcelDialer key={parcelId} parcelId={parcelId} />;
}

const emptyParcels: ParcelFeature[] = [];

const parcelApprovalLabels = {
  checking: 'Checking Inbox approval…',
  pending: 'Awaiting Inbox approval.',
  approved: 'Approved in Inbox. Ready to save.',
  rejected: 'Declined in Inbox.',
  needs_revision: 'Inbox requested a revision.',
  cancelled: 'Approval was cancelled.',
  unavailable: 'Inbox status unavailable. Checking again…',
};

function VanNuysCreateLead({
  parcel,
  onMatch,
}: {
  parcel: ProspectingParcel;
  onMatch: (match: ProspectingMatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const [approvalId, setApprovalId] = useState('');
  const [approvalStatus, setApprovalStatus] = useState<ProspectingApprovalStatus | 'checking' | 'unavailable'>('checking');
  const [busy, setBusy] = useState<'approval' | 'save' | null>(null);
  const [error, setError] = useState('');
  const approved = approvalStatus === 'approved';
  const canRequestAgain = approvalStatus === 'rejected' || approvalStatus === 'needs_revision' || approvalStatus === 'cancelled';

  useEffect(() => {
    if (!open || !approvalId) return;
    let disposed = false;
    let inFlight = false;
    let timer: number | undefined;

    async function refresh() {
      if (disposed || inFlight || document.hidden) return;
      window.clearTimeout(timer);
      inFlight = true;
      try {
        const { status } = await getProspectingParcelApprovalStatus(parcel.parcelId, approvalId);
        if (!disposed) {
          setApprovalStatus(Object.hasOwn(parcelApprovalLabels, status) ? status : 'unavailable');
        }
      } catch {
        if (!disposed) setApprovalStatus('unavailable');
      } finally {
        inFlight = false;
        if (!disposed) timer = window.setTimeout(refresh, 4_000);
      }
    }

    const refreshVisible = () => {
      if (document.hidden) return;
      setApprovalStatus('checking');
      void refresh();
    };
    void refresh();
    document.addEventListener('visibilitychange', refreshVisible);
    window.addEventListener('focus', refreshVisible);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
      window.removeEventListener('focus', refreshVisible);
    };
  }, [approvalId, open, parcel.parcelId]);

  async function submit(action: 'approval' | 'save') {
    if (busy || (action === 'save' && !approved)) return;
    setBusy(action);
    setError('');
    try {
      if (action === 'approval') {
        const response = await requestProspectingParcelApproval(parcel.parcelId);
        if (response.match) {
          onMatch(response.match);
        } else if (response.approvalId) {
          setApprovalStatus('checking');
          setApprovalId(response.approvalId);
        } else {
          throw new Error('The lead approval could not be recorded.');
        }
      } else {
        const { leadId } = await saveApprovedProspectingParcel(parcel.parcelId, approvalId);
        if (!leadId) throw new Error('The CRM did not confirm the saved lead.');
        onMatch({ status: 'matched', leadId });
      }
    } catch (reason) {
      setError(errorText(reason));
      if (action === 'save') setApprovalStatus('checking');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (next) setApprovalStatus('checking');
        setError('');
      }}
    >
      <div>
        <DialogTrigger asChild>
          <button type="button" className="pbk-btn pbk-btn-primary pbk-btn-sm">
            <Plus size={14} aria-hidden="true" /> Create lead
          </button>
        </DialogTrigger>
      </div>
      <DialogContent
        className="pbk-parcel-lead-dialog pbk-van-nuys-lead-dialog"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogTitle>Create lead from parcel</DialogTitle>
        <DialogDescription>
          Review the verified property details before requesting approval. Seller contact fields
          will be blank.
        </DialogDescription>
        <dl className="pbk-dialer-kv">
          <dt>Address</dt>
          <dd>
            {parcel.line1}, {parcel.city}, CA {parcel.zip}
          </dd>
          <dt>Parcel ID</dt>
          <dd>{parcel.parcelId}</dd>
          <dt>County</dt>
          <dd>Los Angeles</dd>
        </dl>
        {approvalId && (
          <div>
            <p role="status">{parcelApprovalLabels[approvalStatus]}</p>
            <Link to="/inbox" target="_blank" rel="noopener" className="underline">
              Review in Inbox
            </Link>
          </div>
        )}
        {error && (
          <p className="pbk-phone-error" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="pbk-btn pbk-btn-ghost" disabled={Boolean(busy)}>
              Close
            </button>
          </DialogClose>
          {approvalId && canRequestAgain && (
            <button
              type="button"
              className="pbk-btn pbk-btn-ghost"
              disabled={Boolean(busy)}
              onClick={() => void submit('approval')}
            >
              Request lead approval again
            </button>
          )}
          <button
            type="button"
            className="pbk-btn pbk-btn-primary"
            disabled={Boolean(busy) || Boolean(approvalId && !approved)}
            onClick={() => void submit(approvalId ? 'save' : 'approval')}
          >
            {busy === 'save'
              ? 'Checking approval and saving…'
              : busy === 'approval'
                ? 'Requesting approval…'
                : approvalId
                  ? 'Save approved lead'
                  : 'Request lead approval'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VanNuysParcelDialer({ parcelId }: { parcelId: string }) {
  const validId = /^\d{10}$/.test(parcelId);
  const [result, setResult] = useState<Awaited<ReturnType<typeof matchProspectingParcel>> | null>(null);
  const [error, setError] = useState('');
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const showProperty = useCallback(() => heading.current?.focus(), []);
  const handleMapUnavailable = useCallback(() => setMapUnavailable(true), []);

  useEffect(() => {
    if (!validId) return;
    let active = true;
    void matchProspectingParcel(parcelId).then((response) => {
      if (!active) return;
      if (response.record?.parcelId !== parcelId) {
        setError('The county could not verify this Van Nuys parcel.');
        return;
      }
      setResult(response);
    }).catch((reason) => {
      if (active) setError(errorText(reason));
    });
    return () => { active = false; };
  }, [parcelId, validId]);

  const parcel = result?.record;
  const point = useMemo(() => {
    const { longitude, latitude } = parcel ?? {};
    if (!parcel || typeof longitude !== 'number' || !Number.isFinite(longitude) ||
        typeof latitude !== 'number' || !Number.isFinite(latitude) ||
        Math.abs(longitude) > 180 || Math.abs(latitude) > 85) return undefined;
    return { parcelId: parcel.parcelId, address: parcel.line1, coordinates: [longitude, latitude] as [number, number] };
  }, [parcel]);
  const status = result?.match.status;
  const leadId = status === 'matched' ? result?.match.leadId : null;

  return (
    <div className="pbk-dialer pbk-dialer-surface">
      <header className="pbk-dialer-head">
        <div>
          <h1>Parcel <em>dialer</em></h1>
          <p>Van Nuys parcel from Prospecting</p>
        </div>
        <Link to="/dialer" className="pbk-btn pbk-btn-ghost">Open Dialer workspace</Link>
      </header>
      <div className="pbk-dialer-reference">
        <Link to="/prospecting">Back to Prospecting</Link>
      </div>
      {!validId && <p className="pbk-phone-error" role="alert">Select a valid LA County parcel from Prospecting.</p>}
      {error && <p className="pbk-phone-error" role="alert">{error}</p>}
      {validId && !result && !error && <p role="status">Verifying the parcel and checking CRM…</p>}
      {parcel && (
        <div className="pbk-dialer-grid pbk-van-nuys-dialer-grid">
          <section className="pbk-dialer-map-card" aria-label="Parcel map">
            <div className="pbk-dialer-section-head">
              <h2><Layers size={16} aria-hidden="true" /> Selected parcel on Mapbox</h2>
            </div>
            {point && mapboxPublicToken && !mapUnavailable ? (
              <div className="pbk-dialer-map" data-streets="true">
                <Suspense fallback={<p className="pbk-dialer-map-empty" role="status">Loading street map…</p>}>
                  <ParcelStreetMap parcels={emptyParcels} selectedPoint={point} busy={false} fitParcels={false}
                    onSelect={showProperty} onUnavailable={handleMapUnavailable} />
                </Suspense>
              </div>
            ) : <p className="pbk-phone-note">Map preview unavailable. The verified parcel and CRM result are still available.</p>}
            {point && <p className="pbk-phone-note">Pin shows the LA County Assessor’s recorded parcel center.</p>}
          </section>
          <section className="pbk-dialer-map-card pbk-van-nuys-dialer-details" aria-labelledby="van-nuys-dialer-property">
            <div className="pbk-parcel-quick-view">
              <h2 id="van-nuys-dialer-property" ref={heading} tabIndex={-1}>{parcel.line1}</h2>
              <p>{parcel.city}, CA {parcel.zip}</p>
              <p role="status" className={`pbk-phone-tag pbk-parcel-match ${status === 'matched' ? 'good' : status === 'ambiguous' ? 'warn' : ''}`}>
                {status === 'matched' ? 'Exact CRM match' : status === 'ambiguous' ? 'Multiple CRM matches' : 'No CRM match'}
              </p>
              <dl className="pbk-parcel-facts">
                <div><dt>Parcel ID</dt><dd>{parcel.parcelId}</dd></div>
                <div><dt>County</dt><dd>Los Angeles</dd></div>
                <div><dt>Building area</dt><dd>{parcel.sqft ? parcel.sqft.toLocaleString() + ' sq ft' : 'Unavailable'}</dd></div>
              </dl>
              {leadId && <Link className="pbk-btn pbk-btn-ghost" to={'/leads/' + encodeURIComponent(leadId)}>Open matching lead</Link>}
              {status === 'no_match' && (
                <VanNuysCreateLead parcel={parcel} onMatch={(match) => {
                  setResult((current) => current && { ...current, match });
                  requestAnimationFrame(showProperty);
                }} />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function RegularParcelDialer() {
  const { hash } = useLocation();
  const [panel, setPanel] = useState<DialerPanel>(() => hash === '#prospecting-list' ? 'shortlist' : 'parcel');
  const [prospects, setProspects] = useState(readParcelProspects);
  const [prospectNotice, setProspectNotice] = useState('');
  const [prospectBrief, setProspectBrief] = useState<ParcelBrief | null>(null);
  const [briefError, setBriefError] = useState('');
  const [coverage, setCoverage] = useState<DialerCoverage | null>(null);
  const [lines, setLines] = useState<OutboundLine[]>([]);
  const [canPlaceCalls, setCanPlaceCalls] = useState(false);
  const [features, setFeatures] = useState<ParcelFeature[]>([]);
  const [lineId, setLineId] = useState('');
  const [selection, setSelection] = useState<DialerSelection | null>(null);
  const savedLeadStatus = useRef<HTMLParagraphElement>(null);
  const [leadReviewOpen, setLeadReviewOpen] = useState(false);
  const [leadSaveError, setLeadSaveError] = useState('');
  const [savedLead, setSavedLead] = useState<{ leadId: string; created: boolean } | null>(null);
  const [quickParcel, setQuickParcel] = useState<ParcelFeature | null>(null);
  const [lookup, setLookup] = useState<{ mode: 'parcel' | 'address'; value: string }>({ mode: 'parcel', value: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [request, setRequest] = useState<{ id: string; approvalId: string; toLast4: string; fromLast4: string; approvalStatus?: string } | null>(null);
  const [call, setCall] = useState<DialerCall | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showStreets, setShowStreets] = useState<boolean | null>(null);
  const [streetMapUnavailable, setStreetMapUnavailable] = useState(false);
  const useBoundaryView = useCallback(() => {
    setStreetMapUnavailable(true);
    setShowStreets(false);
  }, []);
  const [mapNotice, setMapNotice] = useState('');
  const [areaScoped, setAreaScoped] = useState(false);
  const projection = useProjection(features);

  const load = useCallback(async () => {
    setError('');
    try {
      const [cov, parcels] = await Promise.all([fetchDialerCoverage(), fetchParcels()]);
      setCoverage(cov.coverage);
      setLines(cov.lines);
      setCanPlaceCalls(cov.canPlaceCalls);
      setAreaScoped(false);
      setMapNotice('');
      setFeatures(parcels.features);
      setLineId((current) => current || cov.lines.find((l) => l.commissioned && l.callerIdEnabled)?.id || '');
    } catch (err) {
      setError(errorText(err));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (savedLead) savedLeadStatus.current?.focus(); }, [savedLead]);

  // Read-only: resolves parcel, exact CRM match and eligibility. Never dials.
  const choose = useCallback(async (input: { parcelId?: string; address?: string }, nextLine = lineId, preview: ParcelFeature | null = null) => {
    setBusy('select');
    setError('');
    setNotice('');
    setRequest(null);
    setCall(null);
    setSelection(null);
    setProspectBrief(null);
    setBriefError('');
    setSavedLead(null);
    setLeadReviewOpen(false);
    setQuickParcel(preview);
    try {
      const next = await selectParcel({ ...input, lineId: nextLine });
      setSelection(next);
      setQuickParcel(next.parcel);
      if (next.pendingRequest) setRequest(next.pendingRequest);
    } catch (err) {
      setSelection(null);
      setError(errorText(err));
    } finally {
      setBusy('');
    }
  }, [lineId]);

  useEffect(() => {
    if (hash !== '#prospecting-list') return;
    setPanel('shortlist');
    const frame = requestAnimationFrame(() => document.getElementById('prospecting-list')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [hash]);

  const selectedId = selection?.parcel.properties.parcelId || '';
  const source = coverage?.licensed ? coverage.source : '';
  const activeProspects = prospects.filter(item => item.source === source);
  const pendingProspects = activeProspects.filter(item => !item.reviewed).length;
  const currentProspect = activeProspects.find(item => item.parcelId === selectedId);
  const isShortlisted = Boolean(currentProspect);
  const canShortlist = Boolean(source && selection?.ok && selectedId);

  const updateProspects = (items: ParcelProspect[]) => {
    setProspects(items);
    setProspectNotice(saveParcelProspects(items) ? '' : 'This browser could not retain the shortlist after you leave.');
  };

  const addProspect = () => {
    if (!canShortlist || !selection || isShortlisted) return;
    if (prospects.length >= prospectLimit) {
      setProspectNotice('Shortlist is full. Remove a parcel before adding another.');
      return;
    }
    updateProspects([...prospects, parcelProspect(selection.parcel, source)]);
  };

  const toggleProspect = (item: ParcelProspect) =>
    updateProspects(prospects.map(row => row === item ? { ...row, reviewed: !row.reviewed } : row));

  const reviewProspect = async (item: ParcelProspect) => {
    setPanel('parcel');
    setLookup({ mode: 'parcel', value: item.parcelId });
    await choose({ parcelId: item.parcelId });
    document.getElementById('pbk-parcel-quick-heading')?.focus();
  };
  const reselect = (nextLine = lineId) => selectedId && choose({ parcelId: selectedId }, nextLine, quickParcel);
  const chooseFromMap = (parcelId: string) => {
    setPanel('parcel');
    const parcel = features.find((feature) => feature.properties.parcelId === parcelId);
    return choose({ parcelId }, lineId, parcel ?? null);
  };

  const onPolygonKey = (event: KeyboardEvent<SVGPathElement>, parcelId: string) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!busy) void chooseFromMap(parcelId); }
  };

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError('');
    try { await fn(); } catch (err) { setError(errorText(err)); } finally { setBusy(''); }
  };

  const loadProspectingBrief = () => act('brief', async () => {
    setBriefError('');
    setProspectBrief(null);
    try {
      const result = await prepareParcelBrief(selectedId);
      if (result.parcelId !== selectedId) throw new Error('The parcel changed. Select it again to prepare a brief.');
      setProspectBrief(result);
    } catch (err) {
      setBriefError(errorText(err));
    }
  });

  const viewBox = useMemo(() => {
    const w = VIEW_W / zoom;
    const h = VIEW_H / zoom;
    return `${(VIEW_W - w) / 2} ${(VIEW_H - h) / 2} ${w} ${h}`;
  }, [zoom]);

  const property = quickParcel?.properties;
  const situs = property?.situs;
  const previewId = property?.parcelId || '';
  const contact = selection?.contact;
  const canCreateLead = selection?.match.status === 'no_match' && selection.createLeadAvailable && !savedLead;
  const savingLead = busy === 'create-lead';

  const saveLead = () => act('create-lead', async () => {
    setLeadSaveError('');
    try {
      const result = await createLeadFromParcel(selectedId);
      setSavedLead(result);
      setProspectBrief(null);
      setLeadReviewOpen(false);
    } catch (err) {
      setLeadSaveError(errorText(err));
    }
  });
  const streetMapEnabled = showStreets ?? Boolean(mapboxPublicToken);
  const savedActivity = selection?.activity ?? [];
  const activity = call
    ? [{ id: call.id, at: call.createdAt, outcome: call.outcome, status: call.status, talkSeconds: call.talkSeconds },
      ...savedActivity.filter((item) => item.id !== call.id)]
    : savedActivity;
  const approved = request?.approvalStatus === 'approved';
  const steps = ['Parcel', 'Approval', 'Call', 'Outcome'];
  const blockingReasons = selection?.eligibility.reasons.filter((reason) => !(request && reason.code === 'request_pending')) ?? [];
  const stage = call?.finalizedAt ? 3 : call || approved ? 2 : request || selection?.eligibility.eligible ? 1 : 0;
  const phoneStatus = call
    ? (call.outcome || call.status).replace(/[_-]/g, ' ')
    : busy === 'select' ? 'Checking CRM'
      : request ? (approved ? 'Approved' : `Approval ${request.approvalStatus || 'pending'}`)
        : !selection ? 'Select a parcel' : !contact ? 'No verified contact'
          : selection.eligibility.eligible && canPlaceCalls ? 'Ready to request approval' : 'Call unavailable';

  return (
    <div className="pbk-dialer pbk-dialer-surface">
      <header className="pbk-dialer-head">
        <div>
          <h1>Parcel <em>dialer</em></h1>
          <p>Find properties, review CRM matches, and prepare your next step.</p>
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

      <div className="pbk-dialer-reference">
        <Link to="/prospecting"><SavedEvidenceMark size={18} /> Open Prospecting research</Link>
      </div>

      {coverage?.note && <p className="pbk-phone-note">{coverage.note}</p>}
      {error && <div className="pbk-phone-error" role="alert">{error}</div>}

      <div className="pbk-dialer-grid">
        <section className="pbk-dialer-map-card" aria-label="Parcel map">
          <div className="pbk-dialer-section-head">
            <h2><Layers size={16} aria-hidden="true" /> Explore parcels</h2>
            <div className="pbk-phone-actions">
              {coverage && <span className="pbk-phone-tag sky">{features.length} loaded</span>}
              <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" aria-pressed={streetMapEnabled}
                onClick={() => {
                  setStreetMapUnavailable(false);
                  setShowStreets(!streetMapEnabled);
                }}>
                Mapbox streets
              </button>
            </div>
          </div>
          <form className="pbk-phone-form pbk-dialer-lookup" onSubmit={(e) => {
            e.preventDefault();
            if (busy || !lookup.value.trim()) return;
            setPanel('parcel');
            void choose(lookup.mode === 'parcel' ? { parcelId: lookup.value.trim() } : { address: lookup.value.trim() });
          }}>
            <label>Lookup<select className="pbk-input" value={lookup.mode} onChange={(e) => setLookup({ mode: e.target.value as 'parcel' | 'address', value: '' })}><option value="parcel">Parcel ID</option><option value="address">Address</option></select></label>
            <label className="pbk-dialer-lookup-value">{lookup.mode === 'parcel' ? 'Parcel ID' : 'Street, city, ST ZIP'}<input className="pbk-input" value={lookup.value} onChange={(e) => setLookup((l) => ({ ...l, value: e.target.value }))} /></label>
            <button type="submit" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={Boolean(busy) || !lookup.value.trim()}><Search size={15} aria-hidden="true" /> Find</button>
          </form>
          {streetMapUnavailable && <p role="status">Street map unavailable. Parcel boundaries and lookup are still available.</p>}
          <div className="pbk-dialer-map" data-streets={streetMapEnabled}>
            {streetMapEnabled ? (
              <Suspense fallback={<p className="pbk-dialer-map-empty" role="status">Loading street map…</p>}>
              <ParcelStreetMap parcels={features} selected={quickParcel ?? undefined} busy={Boolean(busy)} fitParcels={!areaScoped}
                onUnavailable={useBoundaryView}
                onSelect={(parcelId) => void chooseFromMap(parcelId)}
                onLoadArea={coverage?.licensed ? (bounds) => {
                  setMapNotice('');
                  void act('map', async () => {
                    const result = await fetchParcels(bounds);
                    setAreaScoped(true);
                    setFeatures(result.features);
                    if (!result.features.length) setMapNotice('No parcel boundaries in this area.');
                  });
                } : undefined} />
              </Suspense>
            ) : projection && features.length ? (
              <>
                <svg viewBox={viewBox} role="group" aria-label={`${features.length} parcels. Select one to view its contact; selection never places a call.`}>
                  {features.map((f) => (
                    <path
                      key={f.properties.parcelId}
                      d={projection.pathFor(f)}
                      data-selected={f.properties.parcelId === previewId}
                      aria-pressed={f.properties.parcelId === previewId}
                      aria-disabled={Boolean(busy)}
                      tabIndex={0}
                      role="button"
                      aria-label={`Parcel ${f.properties.parcelId}, ${f.properties.situs.line1}`}
                      onClick={() => { if (!busy) void chooseFromMap(f.properties.parcelId); }}
                      onKeyDown={(e) => { if (!busy) onPolygonKey(e, f.properties.parcelId); }}
                    >
                      <title>{`${f.properties.parcelId} · ${f.properties.situs.line1}`}</title>
                    </path>
                  ))}
                </svg>
                <div className="pbk-dialer-map-tools">
                  <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => setZoom((z) => Math.min(z * 1.5, 6))} aria-label="Zoom in"><Plus size={13} /></button>
                  <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => setZoom((z) => Math.max(z / 1.5, 1))} aria-label="Zoom out"><Minus size={13} /></button>
                </div>
                <div className="pbk-dialer-compass" aria-hidden="true">↑ N</div>
              </>
            ) : (
              <div className="pbk-dialer-map-empty">{coverage?.status === 'unconfigured' ? 'No licensed parcel source is configured. Lookups are unavailable.' : coverage ? 'No parcels in coverage.' : 'Loading parcels…'}</div>
            )}
            {streetMapEnabled && property && (
              <div className="pbk-dialer-fullscreen-selection" aria-live="polite">
                <strong>{situs?.line1}</strong>
                <span>{property.parcelId}{selection?.match.status === 'matched' ? ' · CRM match' : ''}</span>
              </div>
            )}
          </div>
          <div className="pbk-dialer-legend">
            <span><i aria-hidden="true" /> Available parcel</span>
            <span><i aria-hidden="true" /> Selected parcel</span>
            {property && panel === 'parcel' ? <a href="#pbk-parcel-quick-heading">Inspect {situs?.line1 || 'selected parcel'}</a> : <span>Select a parcel to inspect</span>}
          </div>
          {mapNotice && <p className="pbk-phone-note" role="status">{mapNotice}</p>}
        </section>
        <div className="pbk-dialer-inspector">
          {features.length > 0 && (
            <details className="pbk-dialer-map-card pbk-dialer-map-results">
              <summary>Loaded parcels <span>{features.length}</span></summary>
              <ul aria-label="Loaded parcels">
                {features.map(({ properties: parcel }) => (
                  <li key={parcel.parcelId}>
                    <button type="button" disabled={Boolean(busy)}
                      aria-pressed={parcel.parcelId === previewId}
                      onClick={() => void chooseFromMap(parcel.parcelId)}>
                      <strong>{parcel.situs.line1}</strong>
                      <span>{parcel.situs.city} · {parcel.parcelId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <section className="pbk-dialer-map-card" aria-label="Parcel inspector">
          <Tabs className="pbk-parcel-workspace" value={panel} onValueChange={value => setPanel(value as DialerPanel)}>
            <TabsList className="pbk-parcel-workspace-tabs" aria-label="Parcel workspace views">
              <TabsTrigger value="parcel"><MapPin aria-hidden="true" /> Property</TabsTrigger>
              <TabsTrigger value="brief"><ClipboardList aria-hidden="true" /> Brief</TabsTrigger>
              <TabsTrigger value="shortlist">
                <ListChecks aria-hidden="true" /> Shortlist
                {pendingProspects > 0 && <span className="pbk-parcel-tab-count" aria-label={`${pendingProspects} to review`}>{pendingProspects}</span>}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="parcel">
              <section className="pbk-parcel-quick-view" aria-labelledby="pbk-parcel-quick-heading">
                <div className="pbk-dialer-section-head">
                  <h2 id="pbk-parcel-quick-heading" tabIndex={-1}><MapPin size={16} aria-hidden="true" /> Property quick view</h2>
                  {property && <a className="pbk-parcel-phone-link" href="#pbk-virtual-phone">Virtual phone <ArrowDownRight size={13} aria-hidden="true" /></a>}
                </div>
                <div aria-live="polite">
                  {busy === 'select' && <p role="status">Checking parcel and CRM match…</p>}
                  {property && situs ? (
                    <>
                      <h3>{situs.line1}</h3>
                      <p>{[situs.city, situs.state].filter(Boolean).join(', ')} {situs.zip}</p>
                      {selection && <span className={`pbk-phone-tag pbk-parcel-match ${selection.match.status === 'matched' ? 'good' : selection.match.status === 'ambiguous' ? 'warn' : ''}`}>
                        {selection.match.status === 'matched' ? 'Exact CRM match' : selection.match.status === 'ambiguous' ? 'Multiple CRM matches' : 'No CRM match'}
                      </span>}
                      <dl className="pbk-parcel-facts">
                        <div><dt>Parcel ID</dt><dd>{property.parcelId}</dd></div>
                        <div><dt>County</dt><dd>{property.county || 'Unavailable'}</dd></div>
                        <div><dt>Lot size</dt><dd>{typeof property.acres === 'number' && Number.isFinite(property.acres) && property.acres > 0 ? `${property.acres.toLocaleString(undefined, { maximumFractionDigits: 4 })} acres` : 'Unavailable'}</dd></div>
                      </dl>
                    </>
                  ) : <p>Select a parcel on the map or look up an address.</p>}
                </div>
                {canShortlist && (
                  <div className="pbk-phone-actions">
                    <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={Boolean(busy) || isShortlisted} onClick={addProspect}>
                      {isShortlisted ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                      {isShortlisted ? 'On shortlist' : 'Add to shortlist'}
                    </button>
                    {currentProspect && (
                      <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={Boolean(busy)}
                        onClick={() => toggleProspect(currentProspect)}>{currentProspect.reviewed ? 'Reopen review' : 'Mark reviewed'}</button>
                    )}
                  </div>
                )}
                {prospectNotice && <p role="status">{prospectNotice}</p>}
                {canCreateLead && (
                  <Dialog open={leadReviewOpen} onOpenChange={(open) => {
                    if (!savingLead) {
                      setLeadReviewOpen(open);
                      setLeadSaveError('');
                    }
                  }}>
                    <div>
                      <DialogTrigger asChild>
                        <button type="button" className="pbk-btn pbk-btn-primary pbk-btn-sm" disabled={Boolean(busy)}>
                          <Plus size={14} aria-hidden="true" /> Create lead
                        </button>
                      </DialogTrigger>
                    </div>
                    <DialogContent className="pbk-parcel-lead-dialog" onEscapeKeyDown={(event) => { if (savingLead) event.preventDefault(); }}>
                      <DialogTitle>Create lead from parcel</DialogTitle>
                      <DialogDescription>Save the verified property details to CRM. Seller contact fields will be blank.</DialogDescription>
                      <dl className="pbk-dialer-kv">
                        <dt>Address</dt><dd>{situs?.line1}, {situs?.city}, {situs?.state} {situs?.zip}</dd>
                        <dt>Parcel ID</dt><dd>{selectedId}</dd>
                        {property?.county && <><dt>County</dt><dd>{property.county}</dd></>}
                        {Boolean(property?.acres && property.acres > 0) && <><dt>Lot size</dt><dd>{property?.acres} acres</dd></>}
                      </dl>
                      {leadSaveError && <p role="alert">{leadSaveError}</p>}
                      <DialogFooter>
                        <DialogClose asChild><button type="button" className="pbk-btn pbk-btn-ghost" disabled={savingLead}>Cancel</button></DialogClose>
                        <button type="button" className="pbk-btn pbk-btn-primary" disabled={savingLead} onClick={() => void saveLead()}>
                          {savingLead ? 'Saving lead…' : 'Save lead'}
                        </button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
                {savedLead && <p tabIndex={-1} ref={savedLeadStatus} role="status">
                  {savedLead.created ? 'Lead saved.' : 'A matching lead already exists.'}{' '}
                  <Link to={`/leads/${encodeURIComponent(savedLead.leadId)}`}>Open lead</Link>
                </p>}
              </section>
            </TabsContent>
            <TabsContent value="brief">
              {canShortlist ? (
                <ParcelProspectingBrief parcelLabel={situs?.line1 || selectedId} brief={prospectBrief?.parcelId === selectedId ? prospectBrief : null}
                  loading={busy === 'brief'} disabled={Boolean(busy)} error={briefError}
                  onPrepare={() => void loadProspectingBrief()} />
              ) : (
                <section className="pbk-parcel-quick-view" aria-labelledby="pbk-prospecting-brief-empty">
                  <div className="pbk-dialer-section-head"><h2 id="pbk-prospecting-brief-empty"><ClipboardList size={16} aria-hidden="true" /> Prospecting brief</h2></div>
                  <p>Select a verified parcel on the map to prepare its brief.</p>
                </section>
              )}
            </TabsContent>
            <TabsContent value="shortlist">
              <ParcelProspectingList items={activeProspects} selectedId={selectedId} disabled={Boolean(busy)}
                onReview={(item) => void reviewProspect(item)}
                onToggle={toggleProspect}
                onRemove={(item) => updateProspects(prospects.filter(row => row !== item))}
              />
            </TabsContent>
          </Tabs>
        </section>

        <aside className="pbk-dialer-side pbk-virtual-phone" id="pbk-virtual-phone" aria-labelledby="pbk-virtual-phone-heading">
          <div className="pbk-dialer-section-head">
            <h2 id="pbk-virtual-phone-heading"><PhoneCall size={16} aria-hidden="true" /> Virtual phone</h2>
          </div>
          <div className="pbk-virtual-phone-display" aria-live="polite">
            <span className={`pbk-phone-tag ${approved ? 'good' : request ? 'warn' : 'sky'}`}>{phoneStatus}</span>
            <strong>{contact?.name || 'Parcel contact'}</strong>
            <span className="pbk-phone-num">{contact?.phoneDisplay || 'No number loaded'}</span>
            {contact && !contact.synthetic && (
              <Link className="pbk-parcel-phone-link" to={`/inbox/conversations?lead=${encodeURIComponent(contact.crmLeadId || contact.id)}`}>Open seller conversation</Link>
            )}
          </div>
          <ol className="pbk-dialer-steps" aria-label="Call progress">
            {steps.map((step, index) => (
              <li key={step} aria-current={stage === index ? 'step' : undefined} data-complete={stage > index}>
                <span aria-hidden="true">{stage > index ? <Check size={12} /> : index + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <label>Outbound Twilio line
            <select className="pbk-input" value={lineId} disabled={Boolean(busy) || Boolean(request && !call)} onChange={(e) => { setLineId(e.target.value); void reselect(e.target.value); }}>
              <option value="">Choose a line</option>
              {lines.map((l) => <option key={l.id} value={l.id} disabled={!l.commissioned || !l.callerIdEnabled}>{l.display}{!l.commissioned ? ' · not commissioned' : !l.callerIdEnabled ? ' · caller ID off' : ''}</option>)}
            </select>
          </label>
          {!lines.some((l) => l.commissioned && l.callerIdEnabled) && (
            <p className="pbk-phone-note">No commissioned Twilio line yet. Commission one in <Link to="/settings">Settings → Phone numbers</Link>.</p>
          )}

          {selection && (
            <div className="pbk-dialer-contact">
              <dl className="pbk-dialer-kv">
                <dt>CRM match</dt>
                <dd>
                  {selection.match.status === 'matched' && <span className="pbk-phone-tag good">{selection.match.matchedOn === 'verified_address_alias' ? 'verified address alias' : `exact · ${selection.match.matchedOn.replaceAll('_', ' ')}`}</span>}
                  {selection.match.status === 'ambiguous' && <span className="pbk-phone-tag bad">{selection.match.candidateCount} contacts · rejected</span>}
                  {selection.match.status === 'no_match' && <span className="pbk-phone-tag">{savedLead ? 'CRM lead available' : 'no CRM contact'}</span>}
                </dd>
                {!contact && !savedLead && !canCreateLead && <><dt>Next step</dt><dd>Review the parcel in CRM. A street or parcel match does not supply a phone number.</dd></>}
                {contact && (<>
                  <dt>Lead status</dt><dd>{contact.status || '—'}{contact.synthetic ? ' · synthetic' : ''}</dd>
                  {!contact.synthetic && <><dt>CRM lead</dt><dd><Link to={`/leads/${encodeURIComponent(contact.crmLeadId || contact.id)}`}>Open lead</Link></dd></>}
                </>)}
              </dl>
            </div>
          )}
          {contact?.phoneLast4 && /^\d{4}$/.test(contact.phoneLast4) && (
            <ParcelPhoneKeypad key={`${selectedId}:${contact.id}:${contact.phoneLast4}`} lastFour={contact.phoneLast4} />
          )}

          {selection && (
            <div className="pbk-dialer-callbox">
              <div className="pbk-phone-subhead">Call eligibility</div>
              {selection.eligibility.eligible || (request && !blockingReasons.length)
                ? <span className="pbk-phone-ok">Eligible for one manual call.</span>
                : <ul className="pbk-dialer-reasons">{blockingReasons.map((r) => <li key={r.code}>{r.message}</li>)}</ul>}

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
                <div className="pbk-phone-confirm" data-approved={approved}>
                  <span className="pbk-phone-note">One call to the contact ending <strong>{request.toLast4}</strong> from line ending <strong>{request.fromLast4}</strong>. Your phone rings first, then PBK bridges the contact.</span>
                  <span className={`pbk-phone-tag ${request.approvalStatus === 'approved' ? 'good' : 'warn'}`}>approval {request.approvalStatus || 'pending'}</span>
                  <div className="pbk-phone-actions">
                    {approved ? null : coverage?.mock
                      ? <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={Boolean(busy)} onClick={() => act('approve', async () => { await decideApproval(request.approvalId, 'approve'); setRequest({ ...request, approvalStatus: 'approved' }); setNotice('Dev approval recorded.'); })}>Approve (dev)</button>
                      : <Link className="pbk-btn pbk-btn-ghost pbk-btn-sm" to="/inbox">Open approval queue</Link>}
                    {!approved && <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={Boolean(busy)} onClick={() => void reselect()}><RefreshCw size={13} /> Refresh approval</button>}
                    <button type="button" className="pbk-btn pbk-btn-primary pbk-btn-sm" disabled={!approved || !canPlaceCalls || Boolean(blockingReasons.length) || Boolean(busy)}
                      onClick={() => act('dial', async () => { const r = await dialApprovedRequest(request.id); setCall(r.call); setNotice('Call placed. Outcome arrives from signed carrier callbacks.'); })}>
                      <PhoneCall size={13} /> Dial approved call
                    </button>
                  </div>
                </div>
              )}

              {call && (
                <div className="pbk-phone-confirm pbk-dialer-outcome" role="status">
                  <span className="pbk-phone-subhead">{call.finalizedAt ? 'Recorded outcome' : 'Call status'}</span>
                  <strong>{(call.outcome || call.status).replace(/[_-]/g, ' ')}</strong>
                  {call.talkSeconds != null && <span className="pbk-phone-note">{call.talkSeconds}s talk time</span>}
                  {!call.finalizedAt && (
                    <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={Boolean(busy)}
                      onClick={() => act('outcome', async () => {
                        const { calls } = await fetchDialerCalls();
                        const latest = calls.find((item) => item.id === call.id);
                        if (latest) setCall(latest);
                        setNotice(latest?.finalizedAt ? 'Call outcome recorded.' : 'Waiting for the carrier outcome.');
                      })}>
                      <RefreshCw size={13} /> Refresh call status
                    </button>
                  )}
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
          {contact && (
            <div>
              <div className="pbk-phone-subhead">Call activity</div>
              <div className="pbk-dialer-activity">
                {activity.length ? activity.map((a) => (
                  <div key={a.id}><span>{new Date(a.at).toLocaleString()}</span><span>{(a.outcome || a.status).replace(/[_-]/g, ' ')}{a.talkSeconds != null ? ` · ${a.talkSeconds}s talk` : ''}</span></div>
                )) : <span className="pbk-phone-note">No dialer calls yet.</span>}
              </div>
            </div>
          )}
        </aside>
        </div>
      </div>
    </div>
  );
}
