import { useState } from 'react';
import { patchLeadRequest } from '../../utils/runtimeBridge';

export type GhlPipeline = {
  name: string;
  currentStageId: string;
  currentStageLabel: string;
  occurredAt: string;
  nextStageId: string;
  stages: { id: string; label: string; avaNextStepCode?: string }[];
};

export function GhlLeadPipeline({
  pipeline,
  leadId,
  suggestedStageId,
  suggestionRevision,
}: {
  pipeline: GhlPipeline;
  leadId: string;
  suggestedStageId: string;
  suggestionRevision: number;
}) {
  const [selection, setSelection] = useState<{ id: string; revision: number }>();
  const [saved, setSaved] = useState(pipeline.nextStageId);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const options = pipeline.stages.filter((stage) => stage.id !== pipeline.currentStageId);
  const selected = selection?.revision === suggestionRevision
    ? selection.id : suggestedStageId || saved;

  async function save() {
    setBusy(true);
    setNotice('');
    try {
      const response = await patchLeadRequest(leadId, {
        ghlNextStageId: selected,
        ghlExpectedOccurredAt: pipeline.occurredAt,
      });
      if (response.ok === false) throw new Error(String(response.error || 'Could not save the next stage.'));
      setSaved(selected);
      setSelection({ id: selected, revision: suggestionRevision });
      setNotice('Next stage saved in Command Center.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save the next stage.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 grid gap-2" id="lead-ghl-pipeline">
      <p><strong>{pipeline.name}</strong> · {pipeline.currentStageLabel}</p>
      <label htmlFor="ghl-next-stage">Next GoHighLevel stage for review</label>
      <select
        id="ghl-next-stage"
        className="pbk-input min-h-11 w-full"
        value={selected}
        disabled={busy}
        onChange={(event) => setSelection({ id: event.currentTarget.value, revision: suggestionRevision })}
      >
        <option value="">Choose a stage</option>
        {options.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
      </select>
      <button
        className="pbk-btn pbk-btn-ghost min-h-11 justify-self-start"
        type="button"
        disabled={busy || selected === saved || !options.some((stage) => stage.id === selected)}
        onClick={() => void save()}
      >
        Save next stage
      </button>
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
