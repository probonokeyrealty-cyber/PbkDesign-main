import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { fetchAvaConsultationRequest, RuntimeBridgeError, type AvaConsultationRecord } from '../utils/runtimeBridge';

type ConsultationResult = { record: AvaConsultationRecord } | { error: string };

function SavedConsultation({ leadId, consultationId }: { leadId: string; consultationId: string }) {
  const [result, setResult] = useState<ConsultationResult>();

  useEffect(() => {
    let active = true;
    void fetchAvaConsultationRequest(leadId, consultationId).then(
      (record) => { if (active) setResult({ record }); },
      (error: unknown) => {
        if (!active) return;
        setResult({ error: error instanceof RuntimeBridgeError && error.status === 404
          ? 'This saved consultation was not found for this lead.'
          : 'The saved consultation couldn’t load. Refresh to try again.' });
      },
    );
    return () => { active = false; };
  }, [leadId, consultationId]);

  const record = result && 'record' in result ? result.record : undefined;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 [overflow-wrap:anywhere] md:p-8">
      <Link className="pbk-btn pbk-btn-ghost min-h-11" to={`/leads/${encodeURIComponent(leadId)}`}>Back to lead</Link>
      <article className="pbk-lead-portal-card space-y-3" aria-labelledby="saved-consultation-heading">
        <h1 id="saved-consultation-heading" className="text-xl font-semibold">
          {record ? `${record.specialist} consultation record` : 'Saved consultation'}
        </h1>
        {!result && <p role="status">Loading saved consultation…</p>}
        {result && 'error' in result && <p role="alert">{result.error}</p>}
        {record && (
          <>
            <p>{record.summary}</p>
            <time dateTime={record.createdAt} className="text-sm text-[var(--text-secondary)]">
              {new Date(record.createdAt).toLocaleString()}
            </time>
          </>
        )}
      </article>
    </div>
  );
}

export default function AvaConsultation() {
  const { leadId = '', consultationId = '' } = useParams();
  return <SavedConsultation key={JSON.stringify([leadId, consultationId])} leadId={leadId} consultationId={consultationId} />;
}
