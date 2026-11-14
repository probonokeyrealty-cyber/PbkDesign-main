import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, ClipboardCheck, FileUp, Loader2, Search, Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import { CompactPager, getPageSlice, OPERATOR_LIST_PAGE_SIZE } from '../components/CompactPager';
import {
  batchStatuses,
  buildBatchContactPlan,
  buildBatchReview,
  MAX_BATCH_BYTES,
  MAX_BATCH_ROWS,
  parseBatchFile,
  type BatchApplySummary,
  type BatchContactEntry,
  type BatchReviewRow,
  type BatchStatus,
  type FieldComparison,
} from '../utils/batchReview';
import { fetchBatchReviewRosterRequest } from '../utils/runtimeBridge';
import './batchReview.css';

const categoryLabels: Record<BatchStatus, string> = {
  new: 'New',
  match: 'Matches',
  conflict: 'Conflicts',
  invalid: 'Invalid',
};
const rowLabels = { ...categoryLabels, match: 'Match', conflict: 'Conflict' };
const fieldLabels: Record<FieldComparison['disposition'], string> = {
  same: 'Same value',
  empty: 'Saved blank',
  preserved: 'Keep saved',
  incoming: 'Incoming only',
  unmapped: 'Not mapped',
};

function RowDetails({
  row,
  sharedPhones,
  reviewed,
  onToggle,
}: {
  row: BatchReviewRow;
  sharedPhones: BatchContactEntry[];
  reviewed: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <div className="pbk-batch-detail-head">
        <div>
          <span className="pbk-batch-status" data-status={row.status}>
            {rowLabels[row.status]}
          </span>
          <h2>
            Row {row.number}: {row.label}
          </h2>
        </div>
        <button type="button" className="pbk-btn pbk-btn-ghost" onClick={onToggle}>
          <ClipboardCheck size={16} aria-hidden="true" />
          {reviewed ? 'Reopen review' : 'Mark reviewed'}
        </button>
      </div>
      {row.issues.length > 0 && (
        <ul className="pbk-batch-issues">
          {row.issues.map((issue, index) => (
            <li key={index}>{issue}</li>
          ))}
        </ul>
      )}
      {sharedPhones.length > 0 && (
        <div className="pbk-batch-candidates">
          <strong>Shared phone numbers</strong>
          <ul>
            {sharedPhones.map((entry) => (
              <li key={entry.phone}>
                <strong>{entry.phone}</strong>
                {' · Rows '}
                {entry.rows.slice(0, 6).join(', ')}
                {entry.rows.length > 6 && ` +${entry.rows.length - 6} more`}
                {' · '}
                {entry.status === 'dnc'
                  ? 'DNC: blocked on all rows'
                  : entry.status === 'candidate'
                    ? `One contact slot: row ${entry.row}`
                    : entry.status === 'unknown'
                      ? 'DNC unknown: held'
                      : 'No eligible row'}
              </li>
            ))}
          </ul>
        </div>
      )}
      {row.candidates.length > 0 && (
        <details className="pbk-batch-candidates">
          <summary>
            {row.candidates.length} saved {row.candidates.length === 1 ? 'candidate' : 'candidates'}
          </summary>
          <ul>
            {row.candidates.map(({ id, address }, index) => (
              <li key={index}>
                {address || 'Address unavailable'}
                {id && <code>{id}</code>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {row.fields.length ? (
        <table className="pbk-batch-comparison" aria-label="Saved and incoming values">
          <colgroup>
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Saved</th>
              <th scope="col">Incoming</th>
            </tr>
          </thead>
          <tbody>
            {row.fields.map((field, index) => (
              <tr key={index} data-change={field.disposition}>
                <th scope="row">
                  {field.label}
                  <small>{fieldLabels[field.disposition]}</small>
                </th>
                <td>{field.existing || <span className="pbk-batch-muted">Not set</span>}</td>
                <td>{field.incoming}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="pbk-batch-empty">No comparable fields in this row.</p>
      )}
    </>
  );
}

export function BatchReview() {
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<{
    name: string;
    rows: BatchReviewRow[];
    contactPlan: BatchContactEntry[];
    rosterSize: number;
    sampleRevision?: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<{
    summary: BatchApplySummary;
    registeredPhoneCount: number;
  } | null>(null);
  const confirmation = useRef<HTMLDialogElement>(null);
  const [filter, setFilter] = useState<BatchStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  const [sharedOnly, setSharedOnly] = useState(false);
  const [reviewed, setReviewed] = useState<Set<number>>(() => new Set());
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const detail = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const summary = useMemo(() => {
    const counts = { new: 0, match: 0, conflict: 0, invalid: 0 };
    for (const row of batch?.rows ?? []) counts[row.status]++;
    return counts;
  }, [batch]);
  const shared = useMemo(() => {
    const entries = batch?.contactPlan.filter((entry) => entry.rows.length > 1) ?? [];
    const byRow = new Map<number, BatchContactEntry[]>();
    for (const entry of entries)
      for (const number of entry.rows) {
        const list = byRow.get(number) ?? [];
        list.push(entry);
        byRow.set(number, list);
      }
    return { entries, byRow, blocked: entries.filter(({ status }) => status === 'dnc').length };
  }, [batch]);
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return (batch?.rows ?? []).filter(
      (row) =>
        (filter === 'all' || row.status === filter) &&
        (!unreviewedOnly || !reviewed.has(row.number)) &&
        (!sharedOnly || shared.byRow.has(row.number)) &&
        (!search || `${row.number} ${row.label}`.toLowerCase().includes(search))
    );
  }, [batch, filter, query, reviewed, unreviewedOnly, sharedOnly, shared]);
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / OPERATOR_LIST_PAGE_SIZE) - 1)
  );
  const visible = getPageSlice(filtered, safePage);
  const current = visible.find(({ number }) => number === selected) ?? visible[0];
  const eligible = (batch?.rows ?? []).filter(
    (row) => reviewed.has(row.number) && (row.status === 'new' || row.status === 'match')
  );

  const resetReview = () => {
    setFilter('all');
    setQuery('');
    setUnreviewedOnly(false);
    setSharedOnly(false);
    setReviewed(new Set());
    setSelected(null);
    setPage(0);
    setReceipt(null);
  };

  const stage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file || busy.current) return;
    setError('');
    if (file.size > MAX_BATCH_BYTES) {
      setError('Choose a file of 5 MiB or less.');
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      const contents = await file.text();
      const incoming = parseBatchFile(file.name, contents);
      let roster;
      try {
        roster = await fetchBatchReviewRosterRequest();
      } catch {
        throw new Error(
          'Could not confirm the complete saved lead roster. No rows were classified.'
        );
      }
      const rows = buildBatchReview(incoming, roster.leads);
      setBatch({
        name: file.name,
        rows,
        contactPlan: buildBatchContactPlan(
          rows,
          roster.leads,
          new Set(rows.map(({ number }) => number)),
          roster.dncPhones
        ),
        rosterSize: roster.leads.length,
        sampleRevision:
          window.location.hostname === '127.0.0.1' && roster.sampleApply?.sampleCsv === contents
            ? roster.sampleApply.revision
            : undefined,
      });
      resetReview();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not stage this batch.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const applySample = async () => {
    if (
      window.location.hostname !== '127.0.0.1' ||
      !batch?.sampleRevision ||
      !confirmation.current?.open ||
      !eligible.length ||
      busy.current ||
      receipt
    )
      return;
    busy.current = true;
    confirmation.current.close();
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/leads/batch-review-sample-apply', {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmed: true,
          revision: batch.sampleRevision,
          reviewedRows: eligible.map(({ number }) => number),
        }),
      });
      const result = (await response.json()) as {
        ok: boolean;
        summary?: BatchApplySummary;
        registeredPhoneCount?: number;
        error?: string;
      };
      if (
        !response.ok ||
        !result.ok ||
        !result.summary ||
        typeof result.registeredPhoneCount !== 'number' ||
        !Number.isSafeInteger(result.registeredPhoneCount) ||
        result.registeredPhoneCount < 0
      ) {
        throw new Error(result.error || 'Could not apply the sample.');
      }
      setReceipt({ summary: result.summary, registeredPhoneCount: result.registeredPhoneCount });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not apply the sample.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const selectRow = (number: number) => {
    setSelected(number);
    if (window.matchMedia('(max-width: 760px)').matches) detail.current?.focus();
  };

  return (
    <div className="pbk-batch-review">
      <Link to="/leads" className="pbk-batch-back">
        <ArrowLeft size={15} aria-hidden="true" /> Leads
      </Link>
      <header className="pbk-batch-header">
        <h1>Batch review</h1>
        <span>{batch?.sampleRevision ? 'Sample workspace' : 'Preview only'}</span>
      </header>

      <form
        className="pbk-batch-upload"
        onSubmit={(event) => void stage(event)}
        aria-busy={pending}
      >
        <div>
          <label htmlFor="pbk-batch-file">Batch file</label>
          <input
            ref={input}
            id="pbk-batch-file"
            type="file"
            accept=".csv,.json,text/csv,application/json"
            aria-describedby="pbk-batch-format"
            disabled={pending}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setError('');
            }}
          />
          <small id="pbk-batch-format">
            CSV or JSON · Up to {MAX_BATCH_ROWS.toLocaleString()} rows / 5 MiB
          </small>
        </div>
        <button type="submit" className="pbk-btn pbk-btn-primary" disabled={!file || pending}>
          {pending ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <FileUp size={16} aria-hidden="true" />
          )}
          {pending ? 'Working...' : 'Review batch'}
        </button>
      </form>
      {error && (
        <p role="alert" className="pbk-batch-error">
          {error}
        </p>
      )}

      {batch ? (
        <>
          <div className="pbk-batch-meta">
            <div>
              <strong>{batch.name}</strong>
              <span>{batch.rosterSize.toLocaleString()} saved leads compared</span>
              <span role="status">
                {reviewed.size} of {batch.rows.length} reviewed
              </span>
            </div>
            <div className="pbk-batch-meta-actions">
              {batch.sampleRevision && (
                <button
                  type="button"
                  className="pbk-btn pbk-btn-primary"
                  disabled={pending || !eligible.length || Boolean(receipt)}
                  onClick={() => confirmation.current?.showModal()}
                >
                  <ClipboardCheck size={16} aria-hidden="true" /> Apply reviewed sample rows
                </button>
              )}
              <button
                type="button"
                className="pbk-btn pbk-btn-ghost"
                disabled={pending}
                onClick={() => {
                  setBatch(null);
                  setFile(null);
                  setError('');
                  resetReview();
                  if (input.current) input.current.value = '';
                }}
              >
                <Trash2 size={16} aria-hidden="true" /> Clear batch
              </button>
            </div>
          </div>
          {receipt && (
            <section className="pbk-batch-receipt" role="status" aria-label="Sample apply result">
              <strong>Sample applied</strong>
              <span>
                {receipt.summary.created} created · {receipt.summary.updated} updated ·{' '}
                {receipt.summary.unchanged} unchanged
              </span>
              <span>
                {receipt.summary.conflicts} conflicts · {receipt.summary.invalid} invalid ·{' '}
                {receipt.summary.unreviewed} unreviewed skipped
              </span>
              <span>
                {receipt.registeredPhoneCount}{' '}
                {receipt.registeredPhoneCount === 1 ? 'phone number' : 'phone numbers'} registered
              </span>
            </section>
          )}
          <div className="pbk-batch-filters" role="group" aria-label="Row category">
            <button
              type="button"
              aria-pressed={filter === 'all'}
              onClick={() => {
                setFilter('all');
                setPage(0);
                setSelected(null);
              }}
            >
              All rows <strong>{batch.rows.length}</strong>
            </button>
            {batchStatuses.map((status) => (
              <button
                key={status}
                type="button"
                data-status={status}
                aria-pressed={filter === status}
                onClick={() => {
                  setFilter(status);
                  setPage(0);
                  setSelected(null);
                }}
              >
                {categoryLabels[status]} <strong>{summary[status]}</strong>
              </button>
            ))}
          </div>
          <div className="pbk-batch-workspace">
            <section className="pbk-batch-rows" aria-label="Batch rows">
              <div className="pbk-batch-toolbar">
                <label className="pbk-batch-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    aria-label="Search rows"
                    placeholder="Search address or row"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(0);
                      setSelected(null);
                    }}
                  />
                </label>
                <label className="pbk-batch-checkbox">
                  <input
                    type="checkbox"
                    checked={unreviewedOnly}
                    onChange={(event) => {
                      setUnreviewedOnly(event.target.checked);
                      setPage(0);
                      setSelected(null);
                    }}
                  />
                  Unreviewed only
                </label>
                {shared.entries.length > 0 && (
                  <label className="pbk-batch-checkbox">
                    <input
                      type="checkbox"
                      checked={sharedOnly}
                      onChange={(event) => {
                        setSharedOnly(event.target.checked);
                        setPage(0);
                        setSelected(null);
                      }}
                    />
                    Shared phones ({shared.entries.length}, {shared.blocked} DNC)
                  </label>
                )}
              </div>
              {visible.length > 0 ? (
                <>
                  <ul className="pbk-batch-row-list">
                    {visible.map((row) => (
                      <li key={row.number}>
                        <button
                          type="button"
                          aria-pressed={current?.number === row.number}
                          onClick={() => selectRow(row.number)}
                        >
                          <span className="pbk-batch-row-number">{row.number}</span>
                          <span className="pbk-batch-row-label">{row.label}</span>
                          <span className="pbk-batch-status" data-status={row.status}>
                            {rowLabels[row.status]}
                          </span>
                          {reviewed.has(row.number) && <Check size={15} aria-label="Reviewed" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <CompactPager
                    page={safePage}
                    total={filtered.length}
                    label="Batch pages"
                    itemLabel="rows"
                    onPageChange={(nextPage) => {
                      setPage(nextPage);
                      setSelected(null);
                    }}
                  />
                </>
              ) : (
                <p className="pbk-batch-empty">No rows in this view.</p>
              )}
            </section>
            {current && (
              <section
                ref={detail}
                tabIndex={-1}
                className="pbk-batch-detail"
                aria-label="Row comparison"
              >
                <RowDetails
                  row={current}
                  sharedPhones={shared.byRow.get(current.number) ?? []}
                  reviewed={reviewed.has(current.number)}
                  onToggle={() => {
                    setReviewed((previous) => {
                      const next = new Set(previous);
                      if (next.has(current.number)) next.delete(current.number);
                      else next.add(current.number);
                      return next;
                    });
                  }}
                />
              </section>
            )}
          </div>
        </>
      ) : (
        <div className="pbk-batch-start">
          <ClipboardCheck size={24} aria-hidden="true" />
          <div>
            <h2>No batch staged</h2>
            <p>Saved leads and outreach are unchanged.</p>
          </div>
        </div>
      )}
      <dialog
        ref={confirmation}
        className="pbk-batch-confirm"
        aria-labelledby="pbk-batch-confirm-title"
      >
        <h2 id="pbk-batch-confirm-title">Confirm sample apply</h2>
        <dl>
          <div>
            <dt>New reviewed rows</dt>
            <dd>{eligible.filter(({ status }) => status === 'new').length}</dd>
          </div>
          <div>
            <dt>Matched reviewed rows</dt>
            <dd>{eligible.filter(({ status }) => status === 'match').length}</dd>
          </div>
          <div>
            <dt>Conflicts skipped</dt>
            <dd>{summary.conflict}</dd>
          </div>
          <div>
            <dt>Invalid rows skipped</dt>
            <dd>{summary.invalid}</dd>
          </div>
          <div>
            <dt>Unreviewed eligible rows skipped</dt>
            <dd>{summary.new + summary.match - eligible.length}</dd>
          </div>
        </dl>
        <p>
          Only the local sample roster changes. Existing values and DNC flags are kept. No outreach.
        </p>
        <div className="pbk-batch-meta-actions">
          <button
            type="button"
            className="pbk-btn pbk-btn-ghost"
            autoFocus
            onClick={() => confirmation.current?.close()}
          >
            Cancel
          </button>
          <button
            type="button"
            className="pbk-btn pbk-btn-primary"
            disabled={pending || !eligible.length || Boolean(receipt)}
            onClick={() => void applySample()}
          >
            Confirm apply
          </button>
        </div>
      </dialog>
    </div>
  );
}
