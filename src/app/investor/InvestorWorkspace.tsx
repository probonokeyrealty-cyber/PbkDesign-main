import { clearPrivateSession } from './clientState.mjs';
import { useEffect, useRef, useState } from 'react';
import { portalRequest, uploadPortalAsset, type PortalMember } from './portalApi';
import './portal.css';

type Draft = { [key: string]: any; checks: Record<string, boolean> };
type Property = {
  [key: string]: any;
  id: string;
  revision: number;
  draft?: Draft;
  assets: any[];
  published?: any;
};
const blank: Draft = {
  title: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  market: '',
  assetType: 'Single-family',
  owner: '',
  source: '',
  checkedAt: new Date().toISOString().slice(0, 10),
  summary: '',
  knownIssues: '',
  internalNotes: '',
  askingCents: null,
  rehabCents: null,
  arvCents: null,
  beds: null,
  baths: null,
  sqft: null,
  lotSqft: null,
  fictional: true,
  priceOnRequest: false,
  checks: { address: false, sources: false, estimates: false, rights: false, privacy: false },
};
const usd = (value: unknown) =>
  value === null || value === undefined
    ? 'Unknown'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(Number(value) / 100);
const checkLabels: Record<string, string> = {
  address: 'Address and property details verified',
  sources: 'Sources and checked dates recorded',
  estimates: 'Rehab and ARV clearly labeled estimates',
  rights: 'Rights confirmed for all investor-visible media',
  privacy: 'Investor copy contains no seller or internal information',
};
function Packet({
  p,
  busy,
  packetTab,
  setPacketTab,
  act,
}: {
  p: any;
  busy: boolean;
  packetTab: string;
  setPacketTab: (value: string) => void;
  act: (action: () => Promise<void>) => Promise<void>;
}) {
  return (
    <section className="portal-panel" aria-label="Property packet">
      <div className="portal-line">
        <div>
          <p className="portal-eyebrow">
            {p.fictional ? 'FICTIONAL STAGING SAMPLE' : 'PRIVATE PROPERTY PACKET'} · VERSION{' '}
            {p.version}
          </p>
          <h2>{p.title}</h2>
          <p>
            {p.address}, {p.city}, {p.state} {p.zip}
          </p>
        </div>
        <span className="portal-chip">{p.status}</span>
      </div>
      <nav role="tablist" aria-label="Property packet tabs">
        {['Overview', 'Property record', 'Photos'].map((tab, index) => (
          <button
            key={tab}
            role="tab"
            aria-selected={packetTab === tab}
            tabIndex={packetTab === tab ? 0 : -1}
            onClick={() => setPacketTab(tab)}
            onKeyDown={(e) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                const n =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? 2
                      : (index + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
                setPacketTab(['Overview', 'Property record', 'Photos'][n]);
                (e.currentTarget.parentElement?.children[n] as HTMLButtonElement)?.focus();
              }
            }}
          >
            {tab}
          </button>
        ))}
      </nav>
      {packetTab === 'Overview' ? (
        <>
          <p className="portal-price">
            {p.priceOnRequest ? 'Price on request' : usd(p.askingCents)}
          </p>
          <p>{p.summary || 'No summary provided.'}</p>
          <p>{p.knownIssues || 'Known issues: not provided. Complete your own due diligence.'}</p>
          <div className="portal-grid">
            <div className="portal-fact">
              <span>Rehab · estimate</span>
              <strong>{usd(p.rehabCents)}</strong>
            </div>
            <div className="portal-fact">
              <span>ARV · estimate</span>
              <strong>{usd(p.arvCents)}</strong>
            </div>
          </div>
        </>
      ) : packetTab === 'Property record' ? (
        <>
          <dl className="portal-facts">
            {[
              ['Asset type', p.assetType],
              ['Bedrooms', p.beds],
              ['Bathrooms', p.baths],
              ['Living area, sq ft', p.sqft],
              ['Lot area, sq ft', p.lotSqft],
              ['Occupancy', p.occupancy],
              ['Condition', p.condition],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v ?? 'Unknown'}</dd>
              </div>
            ))}
          </dl>
          <p>
            Source: {p.source} · Checked {p.checkedAt}
          </p>
          <p className="portal-muted">
            Unknown means no verified fact was supplied. Values and estimates are informational, not
            a guarantee.
          </p>
        </>
      ) : (
        <div className="portal-empty">
          {p.assets?.filter((a: any) => a.kind === 'photo').length
            ? 'Approved photos are available below.'
            : 'No approved photos yet. No listing photography has been copied.'}
        </div>
      )}
      <div className="portal-assets">
        {p.assets?.map((a: any) => (
          <button
            key={a.id}
            disabled={busy}
            onClick={() =>
              act(async () => {
                const r = await portalRequest('file', { id: p.id, assetId: a.id });
                window.open(r.url, '_blank', 'noopener,noreferrer');
              })
            }
          >
            {a.kind === 'photo' ? 'View photo' : 'Download packet'} · {a.title}
          </button>
        ))}
      </div>
      <p className="portal-muted">
        Private links expire in 60 seconds. A listing, match or inquiry is not an offer or a
        contract.
      </p>
    </section>
  );
}

export function PortalConfirm({
  text,
  onConfirm,
  onCancel,
}: {
  text: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => prior?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="pbk-portal portal-confirm"
      onCancel={onCancel}
      aria-label="Confirm staging property change"
    >
      <h2>Confirm property change</h2>
      <p>{text}</p>
      <div className="portal-actions">
        <button autoFocus onClick={onCancel}>
          Cancel
        </button>
        <button className="portal-primary" onClick={onConfirm}>
          Confirm change
        </button>
      </div>
    </dialog>
  );
}
export function InvestorWorkspace({
  staffMode = false,
  onDirtyChange,
}: {
  staffMode?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [member, setMember] = useState<PortalMember | null>(null),
    [email, setEmail] = useState(''),
    [code, setCode] = useState(''),
    [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [properties, setProperties] = useState<Property[]>([]),
    [inquiries, setInquiries] = useState<any[]>([]),
    [saved, setSaved] = useState<string[]>([]);
  const [view, setView] = useState(staffMode ? 'Property log' : 'Inventory'),
    [selected, setSelected] = useState<Property | null>(null),
    [draft, setDraft] = useState<Draft>({ ...blank, checks: { ...blank.checks } }),
    [editing, setEditing] = useState(false),
    [dirty, setDirty] = useState(false),
    [preview, setPreview] = useState<any>(null),
    [history, setHistory] = useState<any[] | null>(null);
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('All'),
    [assetFilter, setAssetFilter] = useState('All'),
    [maxPrice, setMaxPrice] = useState(''),
    [packetTab, setPacketTab] = useState('Overview');
  const [message, setMessage] = useState(''),
    [proposed, setProposed] = useState(''),
    [timing, setTiming] = useState(''),
    [requestKey, setRequestKey] = useState(() => crypto.randomUUID()),
    [receipt, setReceipt] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null),
    [rights, setRights] = useState(''),
    [alt, setAlt] = useState('');
  const [accessMembers, setAccessMembers] = useState<any[]>([]),
    [investorEmail, setInvestorEmail] = useState(''),
    [contactId, setContactId] = useState('');
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty]);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    const expired = () => {
      clearPrivateState();
      setError('Your session expired. Sign in again.');
    };
    window.addEventListener('pbk-portal-expired', expired);
    return () => window.removeEventListener('pbk-portal-expired', expired);
  }, []);
  useEffect(() => {
    if (!member) return;
    const revalidate = () => {
      if (document.visibilityState === 'visible')
        void portalRequest('session').catch(() => {
          clearPrivateState();
          setError('Your session expired. Sign in again.');
        });
    };
    document.addEventListener('visibilitychange', revalidate);
    return () => document.removeEventListener('visibilitychange', revalidate);
  }, [member]);
  const errorSummary = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) {
      errorSummary.current?.focus();
      errorSummary.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }, [error]);
  function clearPrivateState() {
    clearPrivateSession(
      {
        member: setMember,
        selected: setSelected,
        preview: setPreview,
        history: setHistory,
        receipt: setReceipt,
        accessMembers: setAccessMembers,
        code: setCode,
        codeSent: setCodeSent,
        properties: setProperties,
        inquiries: setInquiries,
        saved: setSaved,
        message: setMessage,
        view: setView,
        draft: setDraft,
        editing: setEditing,
        dirty: setDirty,
        file: setFile,
        rights: setRights,
        alt: setAlt,
        confirmation: setConfirmation,
        search: setSearch,
        filter: setFilter,
        assetFilter: setAssetFilter,
        maxPrice: setMaxPrice,
        packetTab: setPacketTab,
        proposed: setProposed,
        timing: setTiming,
        requestKey: setRequestKey,
        investorEmail: setInvestorEmail,
        contactId: setContactId,
      },
      blank,
      staffMode
    );
  }
  async function refresh() {
    const [p, i, s] = await Promise.all([
      portalRequest('list'),
      portalRequest('inquiries'),
      portalRequest('saved'),
    ]);
    setProperties(p.properties);
    setInquiries(i.inquiries);
    setSaved(s.ids);
  }
  async function act(action: () => Promise<void>) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
      if (
        /session expired|Sign in again|not approved|Sign in to continue/i.test((e as Error).message)
      )
        clearPrivateState();
    } finally {
      setBusy(false);
    }
  }
  function leaveEditor() {
    if (dirty && !window.confirm('Discard unsaved property changes?')) return false;
    setEditing(false);
    setDirty(false);
    return true;
  }
  function edit(p: Property | null) {
    if (!leaveEditor()) return;
    setSelected(p);
    setDraft(p?.draft ? structuredClone(p.draft) : { ...blank, checks: { ...blank.checks } });
    setEditing(true);
    setPreview(null);
    setHistory(null);
    setFile(null);
    setRights('');
    setAlt('');
  }
  function change(key: string, value: unknown) {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
    setPreview(null);
  }
  async function save() {
    const r = await portalRequest('save', {
      id: selected?.id,
      revision: selected?.revision,
      draft,
    });
    setSelected(r.property);
    setDraft(r.property.draft);
    setDirty(false);
    setPreview(null);
    await refresh();
    setNotice(
      'Draft saved privately. Investors cannot see this revision until it is reviewed and released.'
    );
  }
  async function doPreview() {
    if (dirty) throw new Error('Save your draft before previewing.');
    const r = await portalRequest('preview', { id: selected?.id });
    setPreview(r.property);
    setNotice('Investor preview recorded. Review the packet before releasing.');
  }
  const [confirmation, setConfirmation] = useState<{ command: string; status?: string } | null>(
    null
  );
  async function transition(command: string, status?: string) {
    if (dirty) throw new Error('Save or discard your changes first.');
    setConfirmation({ command, status });
  }
  async function applyTransition(command: string, status?: string) {
    if (dirty) throw new Error('Save or discard your changes first.');
    const r = await portalRequest(command, {
      id: selected?.id,
      revision: selected?.revision,
      status,
    });
    setSelected(r.property);
    setPreview(null);
    await refresh();
    setNotice(
      command === 'release'
        ? 'Reviewed version released to approved staging investors.'
        : command === 'withdraw'
          ? 'Property withdrawn. History is preserved.'
          : 'Status updated.'
    );
  }
  const input = (key: string, label: string, kind = 'text') => (
    <label key={key}>
      {label}
      <input
        type={kind}
        value={draft[key] ?? ''}
        onChange={(e) =>
          change(
            key,
            kind === 'number'
              ? e.target.value === ''
                ? null
                : Number(e.target.value)
              : e.target.value
          )
        }
        min={kind === 'number' ? 0 : undefined}
      />
    </label>
  );
  const moneyInput = (key: string, label: string) => (
    <label key={key}>
      {label}
      <input
        type="number"
        min="0"
        step="0.01"
        value={draft[key] === null ? '' : draft[key] / 100}
        onChange={(e) =>
          change(key, e.target.value === '' ? null : Math.round(Number(e.target.value) * 100))
        }
      />
    </label>
  );
  if (!member)
    return (
      <div className={`pbk-portal ${staffMode ? 'portal-staff' : ''}`}>
        <section className="portal-login">
          <p className="portal-eyebrow">PROBONO KEY REALTY · PRIVATE STAGING</p>
          <h1>{staffMode ? 'Your property log.' : 'A clearer view of your next opportunity.'}</h1>
          <p>
            {staffMode
              ? 'Sign in with your approved staff identity to prepare and review properties.'
              : 'Private property packets for approved PBK investors. Sign in with the email on your approved application.'}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                if (!codeSent) {
                  await portalRequest('authStart', { email });
                  setCodeSent(true);
                  setNotice(
                    'If your access is approved, check your email for a sign-in code or link.'
                  );
                } else {
                  await portalRequest('authVerify', { email, code });
                  const r = await portalRequest('session');
                  if (staffMode && r.member.role === 'investor') {
                    await portalRequest('logout');
                    throw new Error('Staff access is required for the property log.');
                  }
                  if (!staffMode && r.member.role !== 'investor') {
                    await portalRequest('logout');
                    throw new Error('Use the staff property log for this staff identity.');
                  }
                  setMember(r.member);
                  await refresh();
                }
              });
            }}
          >
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {codeSent && (
              <label>
                Sign-in code or complete email link
                <input
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
            )}
            <button className="portal-primary" disabled={busy}>
              {busy ? 'Please wait…' : codeSent ? 'Verify and sign in' : 'Send sign-in code'}
            </button>
            {codeSent && (
              <button
                type="button"
                onClick={() => {
                  setCodeSent(false);
                  setCode('');
                }}
              >
                Use another email
              </button>
            )}
          </form>
          {error && (
            <p ref={errorSummary} tabIndex={-1} role="alert" className="portal-error">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <a href="https://www.probonokeyrealty.com/investors#investor-application">
            Not approved yet? Share your Buy Box with PBK →
          </a>
          <p className="portal-muted">
            Staging only. No public inventory. Your sign-in stays in this tab; refreshing asks you
            to sign in again.
          </p>
        </section>
      </div>
    );
  const list = properties.filter((p) => {
    const d = staffMode ? p.draft! : p;
    return (
      (!search ||
        `${d.title} ${d.address} ${d.market}`.toLowerCase().includes(search.toLowerCase())) &&
      (filter === 'All' || p.status === filter) &&
      (assetFilter === 'All' || d.assetType === assetFilter) &&
      (!maxPrice || d.askingCents === null || d.askingCents <= Number(maxPrice) * 100) &&
      (view !== 'Saved properties' || saved.includes(p.id))
    );
  });
  return (
    <div className={`pbk-portal ${staffMode ? 'portal-staff' : ''}`}>
      {confirmation && (
        <PortalConfirm
          text={
            confirmation.command === 'release'
              ? 'Release this reviewed version to approved staging investors?'
              : confirmation.command === 'withdraw'
                ? 'Withdraw this property from staging investor access?'
                : `Change published status to ${confirmation.status}?`
          }
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            const action = confirmation;
            setConfirmation(null);
            void act(() => applyTransition(action.command, action.status));
          }}
        />
      )}
      <header className="portal-header">
        <a className="portal-wordmark" href="https://www.probonokeyrealty.com/">
          PBK <span>{staffMode ? 'Property log' : 'Private investors'}</span>
        </a>
        <div className="portal-line">
          <span className="portal-chip">STAGING · {member.role}</span>
          <button
            disabled={busy}
            onClick={() =>
              act(async () => {
                if (!leaveEditor()) return;
                await portalRequest('logout');
                clearPrivateState();
              })
            }
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="portal-hero">
        <p className="portal-eyebrow">
          {staffMode ? 'PREPARE · REVIEW · RELEASE' : 'CRITERIA · EVIDENCE · NEXT STEP'}
        </p>
        <h1>{staffMode ? 'The property log.' : 'Find the details that matter.'}</h1>
        <p>
          {staffMode
            ? 'One place to prepare a property, release a reviewed packet and see investor inquiries.'
            : 'Browse reviewed property packets, save what fits and start a conversation. Your decisions stay yours.'}
        </p>
      </div>
      <nav
        className="portal-tabs"
        aria-label={staffMode ? 'Property log navigation' : 'Investor navigation'}
      >
        {[
          staffMode ? 'Property log' : 'Inventory',
          ...(staffMode ? [] : ['Saved properties']),
          'My inquiries',
          ...(staffMode ? ['Activity'] : []),
          ...(staffMode && member.role === 'reviewer' ? ['Investor access'] : []),
        ].map((name) => (
          <button
            key={name}
            aria-pressed={view === name}
            onClick={() => {
              if (leaveEditor()) {
                setView(name);
                setSelected(null);
                setReceipt(null);
                if (name === 'Activity')
                  void act(async () => setHistory((await portalRequest('history')).events));
                if (name === 'Investor access')
                  void act(async () => setAccessMembers((await portalRequest('members')).members));
              }
            }}
          >
            {name}
          </button>
        ))}
        <a href="https://www.probonokeyrealty.com/investors#investor-application">Buy Box ↗</a>
        <button disabled={busy} onClick={() => act(refresh)}>
          Refresh
        </button>
      </nav>
      {error && (
        <p ref={errorSummary} tabIndex={-1} role="alert" className="portal-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="portal-notice">
          {notice}
        </p>
      )}
      {editing && staffMode ? (
        <>
          <section className="portal-panel">
            <div className="portal-line">
              <h2>{selected ? 'Edit property' : 'Add a house'}</h2>
              <span className="portal-chip">
                {dirty ? 'UNSAVED CHANGES' : selected?.status || 'NEW DRAFT'}
              </span>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(save);
              }}
            >
              <fieldset disabled={busy}>
                <legend>Property</legend>
                <div className="portal-grid">
                  {input('title', 'Property title')}
                  {input('address', 'Street address')}
                  {input('city', 'City')}
                  {input('state', 'State · two letters')}
                  {input('zip', 'ZIP code')}
                  {input('market', 'Market')}
                  <label>
                    Asset type
                    <select
                      value={draft.assetType}
                      onChange={(e) => change('assetType', e.target.value)}
                    >
                      {['Single-family', '2–4 units', '5+ units', 'Land', 'Commercial'].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  {input('owner', 'Staff owner')}
                  {input('beds', 'Bedrooms', 'number')}
                  {input('baths', 'Bathrooms', 'number')}
                  {input('sqft', 'Living area, sq ft', 'number')}
                  {input('lotSqft', 'Lot area, sq ft', 'number')}
                  {input('occupancy', 'Occupancy')}
                  {input('condition', 'Condition')}
                </div>
              </fieldset>
              <fieldset disabled={busy}>
                <legend>Numbers and sources</legend>
                <div className="portal-grid">
                  {moneyInput('askingCents', 'Asking price, USD')}
                  {moneyInput('rehabCents', 'Rehab estimate, USD')}
                  {moneyInput('arvCents', 'ARV estimate, USD')}
                  {input('source', 'Fact / estimate source')}
                  {input('checkedAt', 'Checked date', 'date')}
                </div>
                <label className="portal-check">
                  <input
                    type="checkbox"
                    checked={draft.priceOnRequest}
                    onChange={(e) => change('priceOnRequest', e.target.checked)}
                  />{' '}
                  Price on request
                </label>
              </fieldset>
              <fieldset disabled={busy}>
                <legend>Investor copy</legend>
                <label>
                  Summary
                  <textarea
                    value={draft.summary}
                    onChange={(e) => change('summary', e.target.value)}
                  />
                </label>
                <label>
                  Known issues / diligence notes
                  <textarea
                    value={draft.knownIssues}
                    onChange={(e) => change('knownIssues', e.target.value)}
                  />
                </label>
                <label className="portal-check">
                  <input
                    type="checkbox"
                    checked={draft.fictional}
                    onChange={(e) => change('fictional', e.target.checked)}
                  />{' '}
                  Fictional staging sample
                </label>
              </fieldset>
              <fieldset disabled={busy}>
                <legend>Internal only</legend>
                <label>
                  Internal staff notes
                  <textarea
                    value={draft.internalNotes}
                    onChange={(e) => change('internalNotes', e.target.value)}
                  />
                </label>
                <p className="portal-muted">These notes never enter the investor response.</p>
              </fieldset>
              <fieldset disabled={busy}>
                <legend>Review checklist</legend>
                {Object.entries(checkLabels).map(([key, label]) => (
                  <label key={key} className="portal-check">
                    <input
                      type="checkbox"
                      checked={draft.checks[key]}
                      onChange={(e) =>
                        change('checks', { ...draft.checks, [key]: e.target.checked })
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <div className="portal-actions">
                <button className="portal-primary" disabled={busy}>
                  Save draft
                </button>
                <button type="button" disabled={busy} onClick={leaveEditor}>
                  Back to property log
                </button>
                {selected && (
                  <button type="button" disabled={busy || dirty} onClick={() => act(doPreview)}>
                    Preview as investor
                  </button>
                )}
                {selected && member.role === 'reviewer' && (
                  <>
                    <button
                      type="button"
                      disabled={busy || dirty || !preview}
                      onClick={() => act(() => transition('release'))}
                    >
                      Release reviewed version
                    </button>
                    {selected.published &&
                      ['Available', 'Under review', 'Under contract'].includes(
                        selected.published.status
                      ) && (
                        <label>
                          Published availability
                          <select
                            disabled={busy || dirty}
                            value={selected.published.status}
                            onChange={(e) => void act(() => transition('status', e.target.value))}
                          >
                            <option>{selected.published.status}</option>
                            {(
                              {
                                Available: ['Under review', 'Under contract'],
                                'Under review': ['Available', 'Under contract'],
                                'Under contract': ['Sold', 'Available'],
                              } as Record<string, string[]>
                            )[selected.published.status]?.map((status) => (
                              <option key={status}>{status}</option>
                            ))}
                          </select>
                        </label>
                      )}
                    <button
                      type="button"
                      disabled={busy || dirty}
                      onClick={() => act(() => transition('withdraw'))}
                    >
                      Withdraw property
                    </button>
                  </>
                )}
                {selected && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      act(async () =>
                        setHistory((await portalRequest('history', { id: selected.id })).events)
                      )
                    }
                  >
                    View property history
                  </button>
                )}
              </div>
            </form>
          </section>
          {selected && (
            <section className="portal-panel">
              <h2>Private photos and packet files</h2>
              <p>PDF, JPG, PNG or WebP, up to 10 MB. Save draft changes before uploading.</p>
              <div className="portal-grid">
                <label>
                  Choose file
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </label>
                <label>
                  Rights basis and rights holder
                  <input value={rights} onChange={(e) => setRights(e.target.value)} />
                </label>
                <label>
                  Photo alt text
                  <input value={alt} onChange={(e) => setAlt(e.target.value)} />
                </label>
              </div>
              <button
                disabled={busy || dirty || !file || !rights}
                onClick={() =>
                  act(async () => {
                    const form = new FormData();
                    form.set('id', selected.id);
                    form.set('revision', String(selected.revision));
                    form.set('file', file!);
                    form.set('title', file!.name);
                    form.set('rights', rights);
                    form.set('alt', alt);
                    form.set('buyerVisible', 'true');
                    const r = await uploadPortalAsset(form);
                    setSelected(r.property);
                    setFile(null);
                    setPreview(null);
                    await refresh();
                    setNotice(
                      'Private file uploaded. Review and release a new version to share it.'
                    );
                  })
                }
              >
                Upload private file
              </button>
              <ul>
                {selected.assets.map((a) => (
                  <li key={a.id}>
                    {a.title} · {a.kind} · Rights recorded
                  </li>
                ))}
              </ul>
            </section>
          )}
          {preview && (
            <Packet
              p={preview}
              busy={busy}
              packetTab={packetTab}
              setPacketTab={setPacketTab}
              act={act}
            />
          )}
        </>
      ) : view === 'Investor access' ? (
        <section className="portal-panel">
          <h2>Approved investor access</h2>
          <p>
            Approve an email only after reviewing its Buy Box. This saves access permission; it does
            not send an invitation or a marketing message.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                if (
                  !window.confirm(`Approve private staging investor access for ${investorEmail}?`)
                )
                  return;
                await portalRequest('approveInvestor', {
                  email: investorEmail,
                  highLevelContactId: contactId,
                });
                setAccessMembers((await portalRequest('members')).members);
                setNotice(
                  'Investor email approved. They can request their own sign-in code from the private portal.'
                );
                setInvestorEmail('');
                setContactId('');
              });
            }}
          >
            <div className="portal-grid">
              <label>
                Investor email
                <input
                  required
                  type="email"
                  value={investorEmail}
                  onChange={(e) => setInvestorEmail(e.target.value)}
                />
              </label>
              <label>
                HighLevel contact ID · optional verified reference
                <input value={contactId} onChange={(e) => setContactId(e.target.value)} />
              </label>
            </div>
            <button className="portal-primary" disabled={busy}>
              Approve investor email
            </button>
          </form>
          {accessMembers.map((m) => (
            <div className="portal-inquiry" key={m.id || m.email}>
              <strong>{m.email}</strong>
              <p>
                {m.role} · {m.approved ? 'Approved' : 'Not approved'}
                {!m.id ? ' · Not signed in yet' : ''}
              </p>
              {m.role === 'investor' && m.approved && (
                <button
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      if (!window.confirm(`Revoke staging investor access for ${m.email}?`)) return;
                      await portalRequest('revokeInvestor', { email: m.email });
                      setAccessMembers((await portalRequest('members')).members);
                      setNotice('Investor access revoked. History is preserved.');
                    })
                  }
                >
                  Revoke investor access
                </button>
              )}
            </div>
          ))}
        </section>
      ) : view === 'Activity' ? (
        <section className="portal-panel">
          <h2>Property activity</h2>
          {history?.map((e) => (
            <div className="portal-history" key={e.id}>
              <strong>{e.action.replaceAll('_', ' ')}</strong>
              <span>
                {new Date(e.at).toLocaleString()} · {e.actor}
              </span>
              <span>{e.entityId}</span>
            </div>
          ))}
        </section>
      ) : view === 'My inquiries' ? (
        <section className="portal-panel">
          <h2>{staffMode ? 'Investor inquiries' : 'My inquiries'}</h2>
          {inquiries.length ? (
            inquiries.map((i) => (
              <article className="portal-inquiry" key={i.id}>
                <span className="portal-chip">{i.status}</span>
                <h3>{i.propertyTitle}</h3>
                <p>{i.message}</p>
                <p>
                  {i.proposedCents === null ? 'No proposed price' : usd(i.proposedCents)} ·{' '}
                  {i.timing || 'Timing not provided'}
                </p>
                <small>
                  Receipt {i.id} · {new Date(i.createdAt).toLocaleString()}
                  {staffMode ? ` · ${i.investorEmail}` : ''}
                </small>
              </article>
            ))
          ) : (
            <div className="portal-empty">No inquiries yet.</div>
          )}
        </section>
      ) : (
        <>
          <section className="portal-panel">
            <div className="portal-line">
              <h2>
                {staffMode
                  ? 'Houses and packets'
                  : view === 'Saved properties'
                    ? 'Saved properties'
                    : 'Reviewed inventory'}
              </h2>
              {staffMode && (
                <button className="portal-primary" disabled={busy} onClick={() => edit(null)}>
                  Add property
                </button>
              )}
            </div>
            <div className="portal-filters">
              <label>
                Search market or address
                <input value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
              <label>
                Status
                <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                  {[
                    'All',
                    ...(staffMode ? ['Draft'] : []),
                    'Available',
                    'Under review',
                    ...(staffMode ? ['Under contract', 'Sold', 'Withdrawn'] : []),
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Asset type
                <select value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
                  {['All', 'Single-family', '2–4 units', '5+ units', 'Land', 'Commercial'].map(
                    (s) => (
                      <option key={s}>{s}</option>
                    )
                  )}
                </select>
              </label>
              <label>
                Maximum price, USD
                <input
                  type="number"
                  min="0"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                />
              </label>
            </div>
            <div className="portal-cards">
              {list.length ? (
                list.map((p) => {
                  const d = staffMode ? p.draft! : p;
                  return (
                    <article className="portal-property" key={p.id}>
                      <div className="portal-parcel" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                        <span />
                      </div>
                      <span className="portal-chip">
                        {p.status}
                        {d.fictional ? ' · FICTIONAL QA' : ''}
                      </span>
                      <h3>{d.title}</h3>
                      <p>
                        {d.address}
                        <br />
                        {d.city}, {d.state} {d.zip}
                      </p>
                      <p className="portal-price">
                        {d.priceOnRequest ? 'Price on request' : usd(d.askingCents)}
                      </p>
                      <p>
                        {d.assetType} · {d.market}
                      </p>
                      <button
                        className="portal-primary"
                        disabled={busy}
                        onClick={() => {
                          setReceipt(null);
                          setPacketTab('Overview');
                          if (staffMode) edit(p);
                          else {
                            if (selected?.id !== p.id) {
                              setRequestKey(crypto.randomUUID());
                              setMessage('');
                              setProposed('');
                              setTiming('');
                            }
                            setSelected(p);
                          }
                        }}
                      >
                        {staffMode ? 'Open draft' : 'View property packet'}
                      </button>
                      {!staffMode && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            act(async () =>
                              setSaved((await portalRequest('toggleSaved', { id: p.id })).ids)
                            )
                          }
                        >
                          {saved.includes(p.id) ? 'Unsave property' : 'Save property'}
                        </button>
                      )}
                    </article>
                  );
                })
              ) : (
                <div className="portal-empty">
                  {staffMode
                    ? 'No houses yet. Add a property to begin a private draft.'
                    : 'No properties match this view. Availability changes; you can update your Buy Box or check again later.'}
                </div>
              )}
            </div>
          </section>
          {selected && !staffMode && (
            <>
              <Packet
                p={selected}
                busy={busy}
                packetTab={packetTab}
                setPacketTab={setPacketTab}
                act={act}
              />
              <section className="portal-panel">
                <h2>Start a conversation</h2>
                <p>
                  This inquiry is nonbinding. It does not reserve a property or create a contract.
                </p>
                {receipt ? (
                  <div role="status">
                    <h3>Inquiry received</h3>
                    <p>Reference: {receipt.id}</p>
                    <p>Your request appears in My inquiries. No appointment has been booked.</p>
                    <button
                      onClick={() => {
                        setReceipt(null);
                        setMessage('');
                        setRequestKey(crypto.randomUUID());
                      }}
                    >
                      Start another inquiry
                    </button>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(async () => {
                        const r = await portalRequest('inquire', {
                          id: selected.id,
                          key: requestKey,
                          version: selected.version,
                          message,
                          proposedCents: proposed ? Math.round(Number(proposed) * 100) : null,
                          timing,
                        });
                        setReceipt(r.inquiry);
                        await refresh();
                      });
                    }}
                  >
                    <label>
                      Your message
                      <textarea
                        required
                        minLength={5}
                        maxLength={2000}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                      />
                    </label>
                    <div className="portal-grid">
                      <label>
                        Proposed price, USD · optional
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={proposed}
                          onChange={(e) => setProposed(e.target.value)}
                        />
                      </label>
                      <label>
                        Timing · optional
                        <input value={timing} onChange={(e) => setTiming(e.target.value)} />
                      </label>
                    </div>
                    <button className="portal-primary" disabled={busy}>
                      {busy ? 'Sending…' : 'Send nonbinding inquiry'}
                    </button>
                  </form>
                )}
              </section>
            </>
          )}
        </>
      )}
      {history && editing && (
        <section className="portal-panel">
          <h2>Property history</h2>
          {history.map((e) => (
            <div className="portal-history" key={e.id}>
              <strong>{e.action.replaceAll('_', ' ')}</strong>
              <span>
                {new Date(e.at).toLocaleString()} · {e.actor}
              </span>
            </div>
          ))}
        </section>
      )}
      <footer className="portal-footer">
        Private staging workspace · No automatic outreach ·{' '}
        <a href="https://www.probonokeyrealty.com/privacy-policy">Privacy</a> ·{' '}
        <a href="https://www.probonokeyrealty.com/terms-conditions">Terms</a>
      </footer>
    </div>
  );
}
