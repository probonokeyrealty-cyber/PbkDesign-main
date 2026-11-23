import { useMemo, useRef, useState } from 'react';
import { ClipboardCheck, Minus, Plus } from 'lucide-react';
import {
  patchLeadRequest,
  type AttomPreviewAddress,
  type RecordedSale,
} from '../../utils/runtimeBridge';
import { compDate } from '../../utils/leadComps.mjs';
import {
  calculateFlipDecision,
  decisionInputLimits,
  maxDecisionScenarios,
  normalizeDecisionScenario,
  readDecisionScenarios,
  type DecisionBasis,
  type DecisionCheck,
  type DecisionComp,
  type DecisionInputs,
  type DecisionKey,
  type DecisionScenario,
} from '../../utils/investorDecisionBrief.mjs';
import type { LeadPortalModel } from './leadPortalModel';

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const amount = (value: number | string | null | undefined) =>
  value == null || value === '' ? '—' : money.format(Number(value));
const formatDate = (value?: string) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(value))
    : 'Date unavailable';
const baseFields: [DecisionKey, string][] = [
  ['arv', 'After-repair value ($)'],
  ['rehab', 'Rehab including contingency ($)'],
  ['closing', 'Acquisition closing costs ($)'],
  ['monthlyCarry', 'Monthly holding costs ($)'],
  ['months', 'Holding period (months)'],
  ['sellingPercent', 'Selling costs (% of resale)'],
  ['targetProfit', 'Minimum profit target ($)'],
];
const stressFields: [DecisionKey, string][] = [
  ['resaleDrop', 'Resale price reduction (%)'],
  ['extraRehab', 'Additional rehab ($)'],
  ['extraMonths', 'Additional months held'],
];
const basisLabels: Record<DecisionBasis, string> = {
  asIs: 'As-is value',
  arv: 'After-repair value',
  rent: 'Market rent',
};
const initialInputs: DecisionInputs = { resaleDrop: 10, extraRehab: 10000, extraMonths: 3 };
const proof = (title: string): DecisionCheck => ({
  title,
  source: '',
  owner: '',
  due: '',
  verified: false,
});
const initialChecks = [
  'Rehab scope and contractor bid',
  'Insurance quote and holding costs',
  'Title and current payoff',
  'Permit or zoning confirmation',
].map(proof);
const newRent = { label: '', amount: '', date: '', source: '', condition: '', rationale: '' };
const ghost = 'pbk-btn pbk-btn-ghost pbk-btn-sm';

function DecisionValues({
  title,
  estimate,
  estimateDate,
  comps,
  selectedSales,
  onChange,
  onOpenComps,
}: {
  title: {
    asIs: number | string | null | undefined;
    arv: number | string | null | undefined;
    rent: number | string | null | undefined;
  };
  estimate: { value: number | null; rent: number | null };
  estimateDate: { value?: string; rent?: string };
  comps: DecisionComp[];
  selectedSales: RecordedSale[];
  onChange: (comps: DecisionComp[]) => void;
  onOpenComps: () => void;
}) {
  const [lease, setLease] = useState(newRent);
  const [leaseError, setLeaseError] = useState('');
  const addLease = () => {
    const value = Number(lease.amount);
    if (
      !lease.label.trim() ||
      !lease.source.trim() ||
      !compDate(lease.date) ||
      !Number.isFinite(value) ||
      value <= 0 ||
      value > 1e9
    ) {
      setLeaseError('Enter a comparable, monthly rent, lease date, and source.');
      return;
    }
    onChange([...comps, { ...lease, amount: value, basis: 'rent', saleId: '' }]);
    setLease(newRent);
    setLeaseError('');
  };
  const chooseSale = (sale: RecordedSale, basis: string) => {
    const previous = comps.find((comp) => comp.saleId === sale.id);
    const rest = comps.filter((comp) => comp.saleId !== sale.id);
    if (basis !== 'asIs' && basis !== 'arv') {
      onChange(rest);
      return;
    }
    onChange([
      ...rest,
      {
        basis,
        saleId: sale.id,
        label: sale.address,
        amount: sale.price,
        date: sale.soldDate,
        source: 'Saved ATTOM comparable sale',
        condition: previous?.condition ?? '',
        rationale: previous?.rationale ?? '',
      },
    ]);
  };
  return (
    <details className="pbk-decision-detail">
      <summary>Value evidence and comparable sales</summary>
      <div className="pbk-decision-value-grid">
        {(Object.keys(basisLabels) as DecisionBasis[]).map((basis) => (
          <div key={basis}>
            <h5>{basisLabels[basis]}</h5>
            <strong>
              {amount(title[basis])}
              {basis === 'rent' && title[basis] != null && title[basis] !== '' ? ' / mo' : ''}
            </strong>
            <small>
              Operator assumption · {comps.filter((comp) => comp.basis === basis).length} supporting
              comps
            </small>
            {basis === 'asIs' && estimate.value !== null && (
              <small>
                ATTOM property estimate {amount(estimate.value)} · {formatDate(estimateDate.value)}
              </small>
            )}
            {basis === 'rent' && estimate.rent !== null && (
              <small>
                ATTOM rental estimate {amount(estimate.rent)} / mo · {formatDate(estimateDate.rent)}
              </small>
            )}
            {comps
              .filter((comp) => comp.basis === basis)
              .map((comp) => {
                const index = comps.indexOf(comp);
                return (
                  <article key={index} className="pbk-decision-comp">
                    <strong>{comp.label}</strong>
                    <small>
                      {amount(comp.amount)}
                      {basis === 'rent' ? ' / mo' : ''} · {formatDate(comp.date)} · {comp.source}
                    </small>
                    {comp.saleId && !selectedSales.some((sale) => sale.id === comp.saleId) && (
                      <small className="pbk-decision-caution">From an earlier selection</small>
                    )}
                    <label>
                      Condition notes
                      <input
                        value={comp.condition}
                        maxLength={240}
                        onChange={(event) =>
                          onChange(
                            comps.map((item, i) =>
                              i === index ? { ...item, condition: event.target.value } : item
                            )
                          )
                        }
                      />
                    </label>
                    <label>
                      Why it fits
                      <input
                        value={comp.rationale}
                        maxLength={400}
                        onChange={(event) =>
                          onChange(
                            comps.map((item, i) =>
                              i === index ? { ...item, rationale: event.target.value } : item
                            )
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className={ghost}
                      onClick={() => onChange(comps.filter((_, i) => i !== index))}
                    >
                      <Minus size={14} aria-hidden /> Remove comp
                    </button>
                  </article>
                );
              })}
          </div>
        ))}
      </div>
      <h5>Use a saved sale as evidence</h5>
      {selectedSales
        .filter((sale) => compDate(sale.soldDate))
        .map((sale) => {
          const basis = comps.find((comp) => comp.saleId === sale.id)?.basis ?? '';
          return (
            <label key={sale.id} className="pbk-decision-comp-picker">
              <span>
                {sale.address} · {amount(sale.price)} · {formatDate(sale.soldDate)}
              </span>
              <select
                value={basis}
                disabled={!basis && comps.length >= 12}
                onChange={(event) => chooseSale(sale, event.target.value)}
              >
                <option value="">Choose value basis</option>
                <option value="asIs">As-is value</option>
                <option value="arv">After-repair value</option>
              </select>
            </label>
          );
        })}
      <button type="button" className={ghost} onClick={onOpenComps}>
        Review saved sales
      </button>
      <h5>Add a lease comparable</h5>
      <div className="pbk-investor-fields">
        <label>
          Lease comparable
          <input
            maxLength={200}
            value={lease.label}
            onChange={(event) => setLease({ ...lease, label: event.target.value })}
          />
        </label>
        <label>
          Monthly lease rent ($)
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={lease.amount}
            onChange={(event) => setLease({ ...lease, amount: event.target.value })}
          />
        </label>
        <label>
          Lease date
          <input
            type="date"
            value={lease.date}
            onChange={(event) => setLease({ ...lease, date: event.target.value })}
          />
        </label>
        <label>
          Lease source
          <input
            maxLength={200}
            value={lease.source}
            onChange={(event) => setLease({ ...lease, source: event.target.value })}
          />
        </label>
      </div>
      <button type="button" className={ghost} disabled={comps.length >= 12} onClick={addLease}>
        <Plus size={14} aria-hidden /> Add lease comp
      </button>
      {leaseError && <p role="alert">{leaseError}</p>}
    </details>
  );
}

export function LeadDealDecisionBrief({
  lead,
  address,
  canSave,
  evidenceVersion,
  selectedSales,
  estimate,
  estimateDate,
  onOpenComps,
  onSaved,
}: {
  lead: LeadPortalModel;
  address: AttomPreviewAddress;
  canSave: boolean;
  evidenceVersion: string;
  selectedSales: RecordedSale[];
  estimate: { value: number | null; rent: number | null };
  estimateDate: { value?: string; rent?: string };
  onOpenComps: () => void;
  onSaved: (leadId: string) => Promise<void>;
}) {
  const deal = lead.raw.deal as { investorDecisionScenarios?: unknown } | undefined;
  const [recent, setRecent] = useState<DecisionScenario[]>([]);
  const saved = useMemo(
    () => readDecisionScenarios(deal?.investorDecisionScenarios),
    [deal?.investorDecisionScenarios]
  );
  const scenarios = [
    ...recent.filter((item) => !saved.some((scenario) => scenario.id === item.id)),
    ...saved,
  ];
  const latest = saved[0] ?? null;
  const [loaded, setLoaded] = useState<DecisionScenario | null>(latest);
  const [acceptedEvidence, setAcceptedEvidence] = useState(latest?.evidence ?? evidenceVersion);
  const [useLiveAsk, setUseLiveAsk] = useState(false);
  const [name, setName] = useState(latest?.name ?? '');
  const [inputs, setInputs] = useState<DecisionInputs>(latest?.inputs ?? initialInputs);
  const [comps, setComps] = useState<DecisionComp[]>(latest?.comps ?? []);
  const [checks, setChecks] = useState<DecisionCheck[]>(latest?.checks ?? initialChecks);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const attempt = useRef<{ id: string; contents: string } | null>(null);
  const openChecks = checks.filter((check) => !check.verified);
  const changed = acceptedEvidence !== evidenceVersion;
  const askingPrice = loaded && !useLiveAsk ? loaded.askingPrice : lead.askingPrice;
  const { base, downside, missing, missingDownside } = calculateFlipDecision(inputs, askingPrice);
  const setValue = (key: DecisionKey, value: string) =>
    setInputs((current) => ({ ...current, [key]: value }));
  const numberField = (key: DecisionKey, label: string) => (
    <label key={key}>
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={decisionInputLimits[key][0]}
        max={decisionInputLimits[key][1]}
        step="0.01"
        value={inputs[key] ?? ''}
        onChange={(event) => setValue(key, event.target.value)}
      />
    </label>
  );
  const chooseScenario = (id: string) => {
    const selection = scenarios.find((item) => item.id === id) ?? null;
    setLoaded(selection);
    setUseLiveAsk(false);
    setAcceptedEvidence(selection?.evidence ?? evidenceVersion);
    setName(selection?.name ?? '');
    setInputs(selection?.inputs ?? initialInputs);
    setComps(selection?.comps ?? []);
    setChecks(selection?.checks ?? initialChecks);
    setStatus('');
    attempt.current = null;
  };
  const save = async () => {
    if (saving || !canSave || !name.trim()) return;
    const payload = { name, inputs, comps, checks, askingPrice, evidence: acceptedEvidence };
    const contents = JSON.stringify(payload);
    const id = attempt.current?.contents === contents ? attempt.current.id : crypto.randomUUID();
    const scenario = normalizeDecisionScenario({ ...payload, id }, new Date().toISOString());
    if (!scenario) {
      setStatus('Check the assumption limits and evidence dates. Verified items need a source.');
      return;
    }
    attempt.current = { id, contents };
    setSaving(true);
    setStatus('');
    try {
      const result = await patchLeadRequest(lead.id, {
        expectedPropertyAddress: address,
        investorDecisionScenario: scenario,
      });
      const committed = normalizeDecisionScenario(result.scenario);
      if (result.ok !== true || committed?.id !== id)
        throw new Error(String(result.error || 'The scenario was not confirmed saved.'));
      setRecent((items) => [committed, ...items.filter((item) => item.id !== committed.id)]);
      setLoaded(committed);
      setUseLiveAsk(false);
      attempt.current = null;
      setStatus('Scenario saved to this lead.');
      try {
        await onSaved(lead.id);
      } catch {
        setStatus('Scenario saved. Reopen the lead to reload the full record.');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to save this scenario.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="pbk-investor-card pbk-decision-brief" aria-label="Deal Decision Brief">
      <header>
        <ClipboardCheck size={20} aria-hidden />
        <h3>Deal Decision Brief</h3>
      </header>
      <p>
        Fix and flip ·{' '}
        {askingPrice && askingPrice > 0
          ? `At ${amount(askingPrice)} ${loaded && !useLiveAsk ? 'saved ' : ''}asking price`
          : 'Asking price unavailable'}
      </p>
      {loaded && !useLiveAsk && loaded.askingPrice !== lead.askingPrice && (
        <button
          type="button"
          className={ghost}
          disabled={saving}
          onClick={() => setUseLiveAsk(true)}
        >
          Use current asking price
        </button>
      )}
      {changed && (
        <p className="pbk-decision-caution" role="status">
          Saved property evidence changed. Review this scenario before relying on it.
        </p>
      )}
      <div className="pbk-decision-summary">
        <section>
          <h5>What price works?</h5>
          <dl>
            <div>
              <dt>Base purchase ceiling</dt>
              <dd>{amount(base?.ceiling)}</dd>
            </div>
            <div>
              <dt>Downside purchase ceiling</dt>
              <dd>{amount(downside?.ceiling)}</dd>
            </div>
          </dl>
          {base && base.ceiling <= 0 && (
            <small>The profit target leaves no positive base purchase price.</small>
          )}
          <small>
            Saved PBK Analyzer figures · MAO {amount(lead.mao && lead.mao > 0 ? lead.mao : null)} ·
            ARV {amount(lead.arv && lead.arv > 0 ? lead.arv : null)}
          </small>
        </section>
        <section>
          <h5>What could wipe out the margin?</h5>
          <dl>
            <div>
              <dt>Base profit at ask</dt>
              <dd data-loss={(base?.profit ?? 0) < 0}>{amount(base?.profit)}</dd>
            </div>
            <div>
              <dt>Downside profit at ask</dt>
              <dd data-loss={(downside?.profit ?? 0) < 0}>{amount(downside?.profit)}</dd>
            </div>
            <div>
              <dt>Base / downside cash before resale</dt>
              <dd>
                {amount(base?.cash)} / {amount(downside?.cash)}
              </dd>
            </div>
          </dl>
          {downside && (
            <small>
              Resale down {inputs.resaleDrop}% · Rehab up {amount(inputs.extraRehab)} · Hold{' '}
              {inputs.extraMonths} months longer
            </small>
          )}
          <small>Cash assumes an all-cash purchase. Selling costs come out at resale.</small>
        </section>
        <section>
          <h5>What needs verifying?</h5>
          <ul>
            {(missing.length > 0 || missingDownside.length > 0) && (
              <li>Complete the scenario inputs.</li>
            )}
            {!comps.some((comp) => comp.basis === 'arv' && comp.rationale.trim()) && (
              <li>Document the after-repair comps.</li>
            )}
            {openChecks.slice(0, 3).map((check, index) => (
              <li key={index}>
                {check.title || 'Untitled verification item'}
                <small>
                  {[check.source, check.owner, check.due && formatDate(check.due)]
                    .filter(Boolean)
                    .join(' · ') || 'Source, owner and due date needed'}
                </small>
              </li>
            ))}
            {openChecks.length > 3 && (
              <li>{openChecks.length - 3} more in the verification checklist</li>
            )}
          </ul>
          {!openChecks.length &&
            !missing.length &&
            !missingDownside.length &&
            comps.some((comp) => comp.basis === 'arv' && comp.rationale.trim()) && (
              <p>All listed checks are marked verified.</p>
            )}
        </section>
      </div>

      <fieldset disabled={saving}>
        <details className="pbk-decision-detail">
          <summary>Scenario assumptions</summary>
          <div className="pbk-investor-fields">
            {baseFields.map(([key, label]) => numberField(key, label))}
          </div>
          <h5>Downside changes together</h5>
          <div className="pbk-investor-fields">
            {stressFields.map(([key, label]) => numberField(key, label))}
          </div>
          <h5>Other value assumptions</h5>
          <div className="pbk-investor-fields">
            {numberField('asIs', 'As-is value ($)')}
            {numberField('rent', 'Market rent ($ / month)')}
          </div>
        </details>
        <DecisionValues
          key={loaded?.id ?? 'new'}
          title={{ asIs: inputs.asIs, arv: inputs.arv, rent: inputs.rent }}
          estimate={estimate}
          estimateDate={estimateDate}
          comps={comps}
          selectedSales={selectedSales}
          onChange={setComps}
          onOpenComps={onOpenComps}
        />
        {changed && (
          <button
            type="button"
            className={ghost}
            onClick={() => {
              setComps((items) =>
                items.map((item) => {
                  const sale = selectedSales.find(({ id }) => id === item.saleId);
                  return sale && compDate(sale.soldDate)
                    ? { ...item, label: sale.address, amount: sale.price, date: sale.soldDate }
                    : item;
                })
              );
              setAcceptedEvidence(evidenceVersion);
            }}
          >
            Use current saved evidence
          </button>
        )}
        <details className="pbk-decision-detail">
          <summary>Verification checklist · {openChecks.length} open</summary>
          {checks.map((check, index) => {
            const update = (patch: Partial<DecisionCheck>) =>
              setChecks((items) =>
                items.map((item, i) => (index === i ? { ...item, ...patch } : item))
              );
            return (
              <div className="pbk-investor-fields pbk-decision-check" key={index}>
                <label>
                  Verification item
                  <input
                    maxLength={120}
                    value={check.title}
                    onChange={(event) => update({ title: event.target.value })}
                  />
                </label>
                <label>
                  Source or document reference
                  <input
                    maxLength={240}
                    value={check.source}
                    onChange={(event) =>
                      update({
                        source: event.target.value,
                        verified: check.verified && Boolean(event.target.value.trim()),
                      })
                    }
                  />
                </label>
                <label>
                  Owner
                  <input
                    maxLength={100}
                    value={check.owner}
                    onChange={(event) => update({ owner: event.target.value })}
                  />
                </label>
                <label>
                  Due date
                  <input
                    type="date"
                    value={check.due}
                    onChange={(event) => update({ due: event.target.value })}
                  />
                </label>
                <label className="pbk-decision-verified">
                  <input
                    type="checkbox"
                    checked={check.verified}
                    disabled={!check.source.trim()}
                    onChange={(event) => update({ verified: event.target.checked })}
                  />{' '}
                  Verified
                </label>
                <button
                  type="button"
                  className={ghost}
                  onClick={() => setChecks((items) => items.filter((_, i) => i !== index))}
                >
                  Remove item
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className={ghost}
            disabled={checks.length >= 12}
            onClick={() => setChecks([...checks, proof('')])}
          >
            <Plus size={14} aria-hidden /> Add verification item
          </button>
        </details>
        <div className="pbk-investor-fields pbk-decision-save">
          <label>
            Saved scenarios
            <select
              value={loaded?.id ?? ''}
              onChange={(event) => chooseScenario(event.target.value)}
            >
              <option value="">New scenario</option>
              {scenarios.map((item, index) => (
                <option key={item.id} value={item.id}>
                  {item.name} · Version {scenarios.length - index} · {formatDate(item.savedAt)}
                  {item.evidence !== evidenceVersion ? ' · Review evidence' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Scenario name
            <input maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
        </div>
        <button
          type="button"
          className="pbk-btn pbk-btn-primary pbk-btn-sm"
          disabled={!canSave || !name.trim() || scenarios.length >= maxDecisionScenarios}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : loaded ? 'Save as new version' : 'Save scenario to lead'}
        </button>
        {!canSave && <small>Complete the property address to save a scenario.</small>}
        {scenarios.length >= maxDecisionScenarios && (
          <small>This lead has reached its saved scenario limit.</small>
        )}
      </fieldset>
      {status && <p role="status">{status}</p>}
    </section>
  );
}
