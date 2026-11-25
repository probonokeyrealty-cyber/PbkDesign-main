import { useState } from 'react';
import { Link } from 'react-router';
import { ListChecks } from 'lucide-react';
import { fetchHighLevelLeadTasks, type HighLevelTaskReview } from '../../utils/runtimeBridge';

const STATUS_TEXT = {
  unmatched: 'This lead has no verified GoHighLevel contact match.',
  not_configured: 'GoHighLevel task access is not configured.',
  unavailable: 'GoHighLevel tasks are temporarily unavailable. Try again.',
};

export function LeadPortalHighLevelTasks({ leadId }: { leadId: string }) {
  const [review, setReview] = useState<HighLevelTaskReview>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function loadTasks() {
    setLoading(true);
    setError(false);
    setReview(undefined);
    try {
      setReview(await fetchHighLevelLeadTasks(leadId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="pbk-lead-portal-card space-y-3" aria-labelledby="lead-crm-tasks-heading">
      <header>
        <h2 id="lead-crm-tasks-heading">GoHighLevel tasks</h2>
        <ListChecks size={19} aria-hidden="true" />
      </header>
      <button className="pbk-btn pbk-btn-ghost min-h-11" type="button" disabled={loading} onClick={loadTasks}>
        {loading ? 'Checking tasks…' : review ? 'Refresh tasks' : 'Check open tasks'}
      </button>
      <div aria-live="polite" aria-busy={loading} className="space-y-3 text-sm [overflow-wrap:anywhere]">
        {error && <p>GoHighLevel tasks could not load for this lead. Try again.</p>}
        {review && review.status !== 'ready' && <p>{STATUS_TEXT[review.status]}</p>}
        {review?.status === 'ready' && (
          <>
            <p className="text-[var(--text-secondary)]">
              Checked <time dateTime={review.checkedAt}>{new Date(review.checkedAt).toLocaleString()}</time>
            </p>
            <a className="pbk-btn pbk-btn-ghost min-h-11" href={review.contactUrl} target="_blank" rel="noopener noreferrer">
              Open contact in GoHighLevel
            </a>
            {review.tasks.length === 0 ? <p>No open tasks for this contact.</p> : (
              <ul className="space-y-3">
                {review.tasks.map((task) => (
                  <li key={task.id} className="pbk-contact-record-status">
                    <strong>{task.title || 'Untitled task'}</strong>
                    <span>
                      {task.dueAt
                        ? <>Due <time dateTime={task.dueAt}>{new Date(task.dueAt).toLocaleString()}</time></>
                        : 'No due date'}
                      {' · '}{task.assigned ? 'Assigned in CRM' : 'Unassigned'}
                    </span>
                    <Link
                      className="pbk-btn pbk-btn-ghost min-h-11"
                      to={`/ava-chat?leadId=${encodeURIComponent(leadId)}`}
                      state={{ highLevelTask: { leadId, title: task.title || 'Untitled task' } }}
                    >
                      Draft a plan with Ava
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
