import { useCallback, useEffect, useState } from 'react';
import { Loader2, Phone, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import {
  confirmQuote, decideApproval, errorText, executeCommission, executeOrder, fetchPhoneInventory, formatPrice,
  importOwnedNumber, quoteNumber, requestCommission, searchAvailableNumbers, setCallerId,
  type AvailableNumber, type NumberType, type PhoneInventory, type PhoneLine, type PhoneProvider, type Quote,
} from '../utils/phoneDialerApi';
import '../../styles/phone-dialer.css';

const PROVIDERS: PhoneProvider[] = ['twilio', 'telnyx'];

function commissionTag(line: PhoneLine) {
  const status = line.commissioning?.status || 'uncommissioned';
  if (status === 'commissioned') return <span className="pbk-phone-tag good">voice route verified</span>;
  if (status === 'legacy_routed') return <span className="pbk-phone-tag sky">existing route</span>;
  if (status === 'readback_mismatch') return <span className="pbk-phone-tag bad">readback mismatch</span>;
  if (status === 'awaiting_approval') return <span className="pbk-phone-tag warn">route awaiting approval</span>;
  return <span className="pbk-phone-tag">uncommissioned</span>;
}

function smsTag(line: PhoneLine) {
  const s = line.sms;
  if (s.sendingAllowed) return <span className="pbk-phone-tag good">SMS registered</span>;
  const label = s.registrationStatus === 'pending_toll_free_verification' ? 'SMS blocked · TF verification' : 'SMS not registered';
  return <span className="pbk-phone-tag warn" title={s.note}>{label}</span>;
}

/** Owned lines across Twilio + Telnyx, import, inventory search and a priced purchase confirmation. */
export function PhoneNumbersPanel() {
  const [inventory, setInventory] = useState<PhoneInventory | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [importForm, setImportForm] = useState<{ provider: PhoneProvider; phoneNumber: string }>({ provider: 'twilio', phoneNumber: '' });
  const [searchForm, setSearchForm] = useState<{ provider: PhoneProvider; type: NumberType; areaCode: string }>({ provider: 'twilio', type: 'local', areaCode: '' });
  const [results, setResults] = useState<AvailableNumber[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [typedLast4, setTypedLast4] = useState('');

  const refresh = useCallback(async () => {
    try {
      setInventory(await fetchPhoneInventory());
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error) });
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (key: string, action: () => Promise<string | void>) => {
    setBusy(key);
    setMessage(null);
    try {
      const text = await action();
      if (text) setMessage({ tone: 'ok', text });
      await refresh();
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error) });
    } finally {
      setBusy('');
    }
  };

  const mock = inventory?.mode === 'mock';
  const canManage = inventory?.canManage === true;
  const approvalHint = (id: string) => (mock
    ? <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => run(`approve-${id}`, async () => { await decideApproval(id, 'approve'); return 'Dev approval recorded.'; })}>Approve (dev)</button>
    : <Link className="pbk-btn pbk-btn-ghost pbk-btn-sm" to="/inbox">Open approval queue</Link>);

  return (
    <section className="pbk-settings-band pbk-phone-panel" aria-labelledby="settings-phone-title">
      <div className="pbk-settings-card-head">
        <div>
          <span className="pbk-kicker">Voice lines</span>
          <h2 id="settings-phone-title">Phone numbers</h2>
          <p className="pbk-phone-note">Owned Twilio and Telnyx lines. Purchases and voice routes go through admin approval; SMS registration is tracked separately.</p>
        </div>
        <div className="pbk-phone-actions">
          {inventory && <span className="pbk-phone-mode" data-mode={inventory.mode}>{inventory.mode === 'mock' ? 'mock providers' : 'live providers'}</span>}
          <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => void refresh()} aria-label="Refresh phone numbers"><RefreshCw size={13} /></button>
        </div>
      </div>

      {message && <div className={message.tone === 'ok' ? 'pbk-phone-ok' : 'pbk-phone-error'} role="status">{message.text}</div>}

      <div className="pbk-phone-table-wrap">
        <table className="pbk-phone-table">
          <thead>
            <tr><th>Line</th><th>Provider</th><th>Roles</th><th>Voice</th><th>SMS</th><th>Caller ID</th></tr>
          </thead>
          <tbody>
            {(inventory?.lines || []).map((line) => (
              <tr key={line.id}>
                <td className="pbk-phone-num">{line.phoneNumber}<div className="pbk-phone-note">{line.type === 'toll_free' ? 'toll-free' : 'local'}</div></td>
                <td>{line.provider}</td>
                <td>
                  <div className="pbk-phone-tags">
                    {line.roles.defaultCallerId && <span className="pbk-phone-tag sky">default caller ID</span>}
                    {line.roles.avaVoiceEngine === 'elevenlabs' && <span className="pbk-phone-tag sky">Ava · ElevenLabs</span>}
                    {!line.roles.defaultCallerId && line.roles.avaVoiceEngine !== 'elevenlabs' && <span className="pbk-phone-tag">{line.source}</span>}
                  </div>
                </td>
                <td>
                  <div className="pbk-phone-tags">{commissionTag(line)}</div>
                  {canManage && line.source !== 'existing_runtime' && (
                    <div className="pbk-phone-actions" style={{ marginTop: 6 }}>
                      {['uncommissioned', 'readback_mismatch'].includes(line.commissioning?.status || 'uncommissioned') && (
                        <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={Boolean(busy)}
                          onClick={() => run(`commission-${line.id}`, async () => { await requestCommission(line.id); return 'Voice route approval queued.'; })}>
                          Request voice route
                        </button>
                      )}
                      {line.commissioning?.status === 'awaiting_approval' && line.commissioning.commissionId && (
                        <>
                          <button type="button" className="pbk-btn pbk-btn-primary pbk-btn-sm" disabled={Boolean(busy)}
                            onClick={() => run(`exec-${line.id}`, async () => { await executeCommission(String(line.commissioning?.commissionId)); return 'Route applied and readback verified.'; })}>
                            Apply approved route
                          </button>
                          {line.commissioning.approvalId && approvalHint(line.commissioning.approvalId)}
                        </>
                      )}
                    </div>
                  )}
                </td>
                <td><div className="pbk-phone-tags">{smsTag(line)}</div></td>
                <td>
                  {line.roles.defaultCallerId ? <span className="pbk-phone-tag good">enabled · locked</span> : (
                    <div className="pbk-phone-actions">
                      <span className={`pbk-phone-tag ${line.callerIdEnabled ? 'good' : ''}`}>{line.callerIdEnabled ? 'enabled' : 'off'}</span>
                      {canManage && line.source !== 'existing_runtime' && (
                        <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm"
                          disabled={Boolean(busy) || (!line.callerIdEnabled && line.commissioning?.status !== 'commissioned')}
                          onClick={() => run(`cid-${line.id}`, async () => { await setCallerId(line.id, !line.callerIdEnabled); return line.callerIdEnabled ? 'Caller ID disabled.' : 'Caller ID enabled after readback check.'; })}>
                          {line.callerIdEnabled ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!inventory && <tr><td colSpan={6}><Loader2 size={14} className="animate-spin" /> Loading lines…</td></tr>}
          </tbody>
        </table>
      </div>

      {inventory && !canManage && <p className="pbk-phone-note">Import, search and purchase require the phone-number management permission.</p>}

      {canManage && (
        <>
          <div className="pbk-phone-subhead">Import an owned number</div>
          <form className="pbk-phone-form" onSubmit={(e) => { e.preventDefault(); void run('import', async () => { const r = await importOwnedNumber(importForm.provider, importForm.phoneNumber); setImportForm((f) => ({ ...f, phoneNumber: '' })); return `Imported line ending ${r.line.last4}.`; }); }}>
            <label>Provider<select className="pbk-input" value={importForm.provider} onChange={(e) => setImportForm((f) => ({ ...f, provider: e.target.value as PhoneProvider }))}>{PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
            <label style={{ flex: '1 1 180px' }}>Exact number (E.164)<input className="pbk-input" inputMode="tel" value={importForm.phoneNumber} onChange={(e) => setImportForm((f) => ({ ...f, phoneNumber: e.target.value }))} placeholder="+1…" /></label>
            <button type="submit" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={Boolean(busy) || !importForm.phoneNumber.trim()}><ShieldCheck size={13} /> Verify &amp; import</button>
          </form>

          <div className="pbk-phone-subhead">Search provider inventory</div>
          <form className="pbk-phone-form" onSubmit={(e) => { e.preventDefault(); void run('search', async () => { setQuote(null); const r = await searchAvailableNumbers(searchForm); setResults(r.results); return r.results.length ? '' : 'No matching numbers.'; }); }}>
            <label>Provider<select className="pbk-input" value={searchForm.provider} onChange={(e) => setSearchForm((f) => ({ ...f, provider: e.target.value as PhoneProvider }))}>{PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
            <label>Type<select className="pbk-input" value={searchForm.type} onChange={(e) => setSearchForm((f) => ({ ...f, type: e.target.value as NumberType }))}><option value="local">Local</option><option value="toll_free">Toll-free</option></select></label>
            {searchForm.type === 'local' && <label>Area code<input className="pbk-input" inputMode="numeric" maxLength={3} value={searchForm.areaCode} onChange={(e) => setSearchForm((f) => ({ ...f, areaCode: e.target.value.replace(/\D/g, '') }))} /></label>}
            <button type="submit" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={Boolean(busy)}><Search size={13} /> Search</button>
          </form>

          {results.length > 0 && !quote && (
            <div className="pbk-phone-results">
              {results.map((r) => (
                <div className="pbk-phone-result" key={`${r.provider}-${r.phoneNumber}`}>
                  <span><span className="pbk-phone-num">{r.phoneNumber}</span> <span className="pbk-phone-note">{r.locality} · {formatPrice(r.price)}</span></span>
                  <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" disabled={Boolean(busy)}
                    onClick={() => run(`quote-${r.phoneNumber}`, async () => { const q = await quoteNumber(r.provider, r.phoneNumber, r.type); setQuote(q.quote); setTypedLast4(''); })}>
                    Get price
                  </button>
                </div>
              ))}
            </div>
          )}

          {quote && (
            <div className="pbk-phone-confirm" role="group" aria-label="Confirm number purchase">
              <div className="pbk-phone-subhead">Confirm purchase request</div>
              <div><strong>{quote.phoneNumber}</strong> on {quote.provider} · {quote.type === 'toll_free' ? 'toll-free' : 'local'}</div>
              <div><strong>{formatPrice(quote.price)}</strong> <span className="pbk-phone-note">({quote.price.currency}) · quote expires {new Date(quote.expiresAt).toLocaleTimeString()}</span></div>
              <p className="pbk-phone-note">This queues an admin approval for this exact number and price. Nothing is purchased until the approval is granted and the order is executed{inventory?.purchasesEnabled || mock ? '' : ' (live purchases are disabled in this environment)'}.</p>
              <label className="pbk-phone-form">Type the last 4 digits to confirm<input className="pbk-input" inputMode="numeric" maxLength={4} value={typedLast4} onChange={(e) => setTypedLast4(e.target.value.replace(/\D/g, ''))} /></label>
              <div className="pbk-phone-actions">
                <button type="button" className="pbk-btn pbk-btn-primary pbk-btn-sm" disabled={Boolean(busy) || typedLast4 !== quote.phoneNumber.slice(-4)}
                  onClick={() => run('order', async () => { await confirmQuote(quote); setQuote(null); setResults([]); return 'Purchase approval queued for this exact number.'; })}>
                  <Phone size={13} /> Request purchase approval
                </button>
                <button type="button" className="pbk-btn pbk-btn-ghost pbk-btn-sm" onClick={() => setQuote(null)}>Cancel</button>
              </div>
            </div>
          )}

          {(inventory?.orders || []).filter((o) => o.status !== 'purchased').length > 0 && (
            <>
              <div className="pbk-phone-subhead">Open orders</div>
              <div className="pbk-phone-results">
                {inventory!.orders.filter((o) => o.status !== 'purchased').map((o) => (
                  <div className="pbk-phone-result" key={o.id}>
                    <span><span className="pbk-phone-num">{o.phoneNumber}</span> <span className="pbk-phone-note">{o.provider} · {formatPrice(o.price)} · {o.status.replace(/_/g, ' ')}</span></span>
                    <span className="pbk-phone-actions">
                      {o.status === 'awaiting_approval' && o.approvalId && approvalHint(o.approvalId)}
                      {['awaiting_approval', 'unknown', 'provider_pending'].includes(o.status) && (
                        <button type="button" className="pbk-btn pbk-btn-primary pbk-btn-sm" disabled={Boolean(busy)}
                          onClick={() => run(`exec-${o.id}`, async () => { const r = await executeOrder(o.id); return r.pending ? 'Provider order pending; reconcile again shortly.' : 'Number purchased. Commission it before use.'; })}>
                          {o.status === 'awaiting_approval' ? 'Execute approved order' : 'Reconcile order'}
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
