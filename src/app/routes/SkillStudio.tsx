import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  ChevronLeft,
  CircleDot,
  Database,
  FileCheck2,
  FileText,
  Filter,
  GitBranch,
  History,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Youtube,
  X,
} from 'lucide-react';
import { CompactPager, getPageSlice, OPERATOR_LIST_PAGE_SIZE } from '../components/CompactPager';
import {
  activateSkillVersionRequest,
  approveSkillVersionRequest,
  createSkillCandidateRequest,
  fetchSkillGovernanceRepositoryRequest,
  fetchSkillGovernanceStatusRequest,
  ingestSkillCandidatesRequest,
  rollbackSkillActivationRequest,
  type SkillGovernanceItem,
  type SkillGovernanceStatusResponse,
} from '../utils/runtimeBridge';

const LIFECYCLE_STEPS = [
  'Review',
  'Practice',
  'Fit',
  'Agent',
  'Approve',
  'Start small',
  'Outcomes',
];

const STATE_LABELS: Record<string, string> = {
  candidate: 'Candidate',
  needs_review: 'Needs review',
  test_ready: 'Test ready',
  testing: 'Testing',
  failed: 'Failed',
  ready_for_approval: 'Ready for approval',
  approved_inactive: 'Ready to use',
  canary: 'Small test',
  active: 'Live',
  paused: 'Paused',
  rolled_back: 'Rolled back',
  retired: 'Retired',
};

const STATE_STEP: Record<string, number> = {
  candidate: 0,
  needs_review: 0,
  test_ready: 1,
  testing: 1,
  failed: 1,
  ready_for_approval: 4,
  approved_inactive: 5,
  canary: 5,
  active: 6,
  paused: 6,
  rolled_back: 6,
  retired: 6,
};

const SKILL_WIZARD_STEPS = ['Situation', 'Ava reply', 'Next question', 'Preview'] as const;

const SKILL_TRIGGER_OPTIONS = [
  { value: 'price_objection', label: 'Price objection' },
  { value: 'probate', label: 'Probate or inherited property' },
  { value: 'need_to_think', label: 'Need to think' },
  { value: 'trust_concern', label: 'Trust or scam concern' },
  { value: 'spouse_partner', label: 'Spouse or partner approval' },
  { value: 'timeline_mismatch', label: 'Timeline mismatch' },
  { value: 'repair_overwhelm', label: 'Repair overwhelm' },
  { value: 'seller_target_price', label: 'Seller gives target price' },
] as const;

function getSkillTriggerLabel(value: string) {
  return SKILL_TRIGGER_OPTIONS.find((option) => option.value === value)?.label || value;
}

function displayDate(value?: string | null) {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function readNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const numeric = readNumber(value);
    if (numeric !== null) return numeric;
  }
  return null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const textValue = String(value || '').trim();
    if (textValue) return textValue;
  }
  return '';
}

function percentLabel(value: number | null) {
  if (value === null) return 'N/A';
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.max(0, Math.min(100, normalized)).toFixed(0)}%`;
}

function signedPercentLabel(value: number | null) {
  if (value === null) return 'No delta';
  const normalized = value <= 1 && value >= -1 ? value * 100 : value;
  const clamped = Math.max(-100, Math.min(100, normalized));
  return `${clamped > 0 ? '+' : ''}${clamped.toFixed(0)}% wk`;
}

function getSkillPerformance(item: SkillGovernanceItem) {
  const raw = item as SkillGovernanceItem & Record<string, unknown>;
  const outcomes = readRecord(raw.outcomes || raw.outcomeStats || raw.performance);
  const metrics = readRecord(raw.metrics || raw.analytics || raw.skillMetrics);
  const usageCount =
    firstNumber(
      raw.usageCount,
      raw.usage_count,
      raw.uses,
      raw.totalUses,
      outcomes.usageCount,
      outcomes.uses,
      metrics.usageCount,
      metrics.uses
    ) || 0;
  const wins =
    firstNumber(raw.wins, raw.successes, outcomes.wins, outcomes.successes, metrics.wins) || 0;
  const losses =
    firstNumber(raw.losses, raw.failures, outcomes.losses, outcomes.failures, metrics.losses) || 0;
  const derivedRate = usageCount > 0 ? wins / Math.max(1, wins + losses || usageCount) : null;
  const successRate = firstNumber(
    raw.successRate,
    raw.success_rate,
    outcomes.successRate,
    outcomes.success_rate,
    metrics.successRate,
    derivedRate
  );
  const confidence = firstNumber(
    raw.confidence,
    raw.confidenceScore,
    raw.confidence_score,
    outcomes.confidence,
    metrics.confidence
  );
  const confidenceDelta = firstNumber(
    raw.confidenceDelta,
    raw.confidence_delta,
    raw.weeklyDelta,
    raw.weekly_delta,
    outcomes.confidenceDelta,
    metrics.confidenceDelta
  );
  const lastTriggeredAt = firstText(
    raw.lastTriggeredAt,
    raw.last_triggered_at,
    raw.lastUsedAt,
    raw.last_used_at,
    outcomes.lastTriggeredAt,
    metrics.lastTriggeredAt
  );
  return {
    usageCount,
    successRate,
    confidence,
    confidenceDelta,
    lastTriggeredAt,
    trendTone:
      confidenceDelta === null
        ? 'neutral'
        : confidenceDelta > 0
          ? 'up'
          : confidenceDelta < 0
            ? 'down'
            : 'neutral',
  };
}

function JsonSummary({ value }: { value?: Record<string, unknown> }) {
  const entries = Object.entries(value || {});
  if (!entries.length) return <span className="pbk-skill-muted">None recorded</span>;
  return (
    <dl className="pbk-skill-json-summary">
      {entries.slice(0, 6).map(([key, item]) => (
        <div key={key}>
          <dt>{key.replace(/_/g, ' ')}</dt>
          <dd>{formatSkillSummaryValue(item)}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatSkillSummaryValue(value: unknown) {
  if (Array.isArray(value))
    return value.length ? `${value.length} saved item${value.length === 1 ? '' : 's'}` : 'None';
  if (value && typeof value === 'object') {
    const readable = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => ['string', 'number', 'boolean'].includes(typeof item))
      .slice(0, 3)
      .map(([key, item]) => `${key.replace(/_/g, ' ')}: ${String(item)}`)
      .join(' · ');
    return readable || 'Saved details';
  }
  return String(value ?? 'None recorded');
}

function formatSkillScope(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return String(value || 'Available when Ava needs it');
  }
  const record = value as Record<string, unknown>;
  return (
    [record.type, record.stage, record.audience, record.channel]
      .filter((item) => typeof item === 'string' && item.trim())
      .join(' · ') || 'Available when Ava needs it'
  );
}

function CreateCandidateDialog({
  open,
  busy,
  onClose,
  onCreate,
  onIngest,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
  onIngest: (payload: {
    sourceType: 'youtube' | 'article' | 'text';
    source: string;
    agentId: string;
    maxCandidates: number;
    manualTranscript?: string;
    audioTranscriptUrl?: string;
    text?: string;
    title?: string;
  }) => Promise<void>;
}) {
  const [mode, setMode] = useState<'manual' | 'youtube' | 'article'>('manual');
  const [wizardStep, setWizardStep] = useState(0);
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<string>(SKILL_TRIGGER_OPTIONS[0].value);
  const [instructions, setInstructions] = useState('');
  const [nextQuestion, setNextQuestion] = useState('');
  const [riskClass, setRiskClass] = useState('medium');
  const [agentId, setAgentId] = useState('ava');
  const [sourceNote, setSourceNote] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [manualTranscript, setManualTranscript] = useState('');
  const [audioTranscriptUrl, setAudioTranscriptUrl] = useState('');
  const [articleUrl, setArticleUrl] = useState('');
  const [articleTitle, setArticleTitle] = useState('');
  const [articleText, setArticleText] = useState('');
  const [maxCandidates, setMaxCandidates] = useState(5);
  if (!open) return null;
  const triggerLabel = getSkillTriggerLabel(triggerType);
  const compiledManualInstructions = [
    `Trigger: ${triggerLabel}.`,
    `Response: ${instructions.trim()}`,
    `Next question: ${nextQuestion.trim()}`,
    'Runtime rule: acknowledge the seller context first, avoid repeating answered facts, ask only this one next question unless the turn contract blocks it, and keep the skill review-only until governed activation.',
  ]
    .filter(Boolean)
    .join('\n\n');
  const manualStepReady =
    wizardStep === 0
      ? Boolean(name.trim() && triggerType && agentId)
      : wizardStep === 1
        ? Boolean(instructions.trim())
        : wizardStep === 2
          ? Boolean(nextQuestion.trim())
          : Boolean(name.trim() && instructions.trim() && nextQuestion.trim());
  const manualCanSave = Boolean(name.trim() && instructions.trim() && nextQuestion.trim());
  return (
    <div
      className="pbk-skill-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="pbk-skill-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-candidate-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Ava training</span>
            <h2 id="skill-candidate-title">Teach Ava a new skill</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close candidate form">
            <X size={18} />
          </button>
        </header>
        <div className="pbk-skill-dialog-body">
          <div className="pbk-skill-intake-mode" role="tablist" aria-label="Skill intake method">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'manual'}
              className={mode === 'manual' ? 'active' : ''}
              onClick={() => {
                setMode('manual');
                setWizardStep(0);
              }}
            >
              <Plus size={15} />
              Type it
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'youtube'}
              className={mode === 'youtube' ? 'active' : ''}
              onClick={() => setMode('youtube')}
            >
              <Youtube size={16} />
              Video
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'article'}
              className={mode === 'article' ? 'active' : ''}
              onClick={() => setMode('article')}
            >
              <FileText size={16} />
              Article
            </button>
          </div>
          <p>
            {mode === 'manual'
              ? 'Write the situation, what Ava should say, and the next question. The draft waits for review before Ava can use it.'
              : mode === 'youtube'
                ? 'Add a training video or pasted notes. Ava turns it into draft responses for review.'
                : 'Paste an article, screenshot text, or coaching notes. Ava turns the useful parts into draft responses.'}
          </p>
          {mode === 'manual' ? (
            <>
              <div className="pbk-skill-wizard-steps" aria-label="Manual skill creation steps">
                {SKILL_WIZARD_STEPS.map((step, index) => (
                  <button
                    key={step}
                    type="button"
                    className={index === wizardStep ? 'active' : index < wizardStep ? 'done' : ''}
                    onClick={() => setWizardStep(index)}
                    aria-current={index === wizardStep ? 'step' : undefined}
                  >
                    <span>{index + 1}</span>
                    {step}
                  </button>
                ))}
              </div>

              {wizardStep === 0 && (
                <div className="pbk-skill-wizard-panel">
                  <label>
                    Skill name
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Price-gap discovery"
                      autoFocus
                    />
                  </label>
                  <label>
                    Seller situation
                    <select
                      value={triggerType}
                      onChange={(event) => setTriggerType(event.target.value)}
                    >
                      {SKILL_TRIGGER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Who should use it?
                    <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                      <option value="ava">Ava</option>
                      <option value="rex">Rex</option>
                      <option value="nurture-agent">Nurture</option>
                      <option value="max">Max</option>
                    </select>
                  </label>
                  <details className="pbk-skill-advanced">
                    <summary>Advanced safety details</summary>
                    <label>
                      Safety level
                      <select
                        value={riskClass}
                        onChange={(event) => setRiskClass(event.target.value)}
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </label>
                  </details>
                </div>
              )}

              {wizardStep === 1 && (
                <div className="pbk-skill-wizard-panel">
                  <label>
                    What should Ava say?
                    <textarea
                      value={instructions}
                      onChange={(event) => setInstructions(event.target.value)}
                      placeholder="Write what Ava or the selected agent should say or do when this trigger appears."
                      rows={7}
                      autoFocus
                    />
                  </label>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="pbk-skill-wizard-panel">
                  <label>
                    What should Ava ask next?
                    <textarea
                      value={nextQuestion}
                      onChange={(event) => setNextQuestion(event.target.value)}
                      placeholder="Ask one sharp follow-up question that advances the deal without repeating known facts."
                      rows={4}
                      autoFocus
                    />
                  </label>
                  <details className="pbk-skill-advanced">
                    <summary>Advanced source details</summary>
                    <label>
                      Where did this come from?
                      <input
                        value={sourceNote}
                        onChange={(event) => setSourceNote(event.target.value)}
                        placeholder="Call review, training source, coaching note..."
                      />
                    </label>
                  </details>
                </div>
              )}

              {wizardStep === 3 && (
                <div className="pbk-skill-wizard-panel">
                  <div className="pbk-skill-wizard-preview">
                    <dl>
                      <div>
                        <dt>Candidate</dt>
                        <dd>{name.trim() || 'Untitled skill'}</dd>
                      </div>
                      <div>
                        <dt>Trigger</dt>
                        <dd>{triggerLabel}</dd>
                      </div>
                      <div>
                        <dt>Agent</dt>
                        <dd>{agentId}</dd>
                      </div>
                      <div>
                        <dt>Risk</dt>
                        <dd>{riskClass}</dd>
                      </div>
                    </dl>
                    <pre>{compiledManualInstructions}</pre>
                  </div>
                </div>
              )}
            </>
          ) : mode === 'youtube' ? (
            <>
              <label>
                YouTube URL
                <div className="pbk-skill-youtube-input">
                  <Youtube size={17} aria-hidden="true" />
                  <input
                    value={youtubeUrl}
                    onChange={(event) => setYoutubeUrl(event.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoFocus
                  />
                </div>
              </label>
              <div className="pbk-skill-dialog-grid">
                <label>
                  Who should learn it?
                  <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                    <option value="ava">Ava</option>
                    <option value="rex">Rex</option>
                    <option value="nurture-agent">Nurture</option>
                    <option value="max">Max</option>
                  </select>
                </label>
                <label>
                  How many drafts?
                  <select
                    value={maxCandidates}
                    onChange={(event) => setMaxCandidates(Number(event.target.value))}
                  >
                    <option value={3}>3 focused skills</option>
                    <option value={5}>5 balanced skills</option>
                    <option value={8}>8 broad skills</option>
                  </select>
                </label>
              </div>
              <div className="pbk-skill-youtube-note">
                <ShieldCheck size={18} />
                <div>
                  <strong>Review stays mandatory</strong>
                  <span>
                    Ava can draft from training material, but nothing goes live until a person
                    reviews and approves it.
                  </span>
                </div>
              </div>
              <label className="pbk-skill-audio-fallback">
                Advanced: direct media link
                <input
                  value={audioTranscriptUrl}
                  onChange={(event) => setAudioTranscriptUrl(event.target.value)}
                  placeholder="https://.../training-call.mp3"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
                <small>
                  Optional. Use a public MP3, M4A, WAV, MP4, MOV, or WebM file when the video cannot
                  provide text. A normal YouTube watch link is not a direct media file.
                </small>
              </label>
              <label className="pbk-skill-youtube-fallback">
                Paste transcript or detailed notes
                <textarea
                  value={manualTranscript}
                  onChange={(event) => setManualTranscript(event.target.value)}
                  placeholder="Optional fallback for videos with disabled captions. Paste the transcript, show notes, or detailed training notes here."
                  rows={5}
                />
                <small>
                  Use this when the video has no transcript. Ava still creates review-only drafts,
                  never live skills.
                </small>
              </label>
            </>
          ) : (
            <>
              <label>
                Article title
                <input
                  value={articleTitle}
                  onChange={(event) => setArticleTitle(event.target.value)}
                  placeholder="Negotiation article, screenshot notes, or training doctrine"
                  autoFocus
                />
              </label>
              <label>
                Article URL
                <div className="pbk-skill-source-input">
                  <FileText size={17} aria-hidden="true" />
                  <input
                    value={articleUrl}
                    onChange={(event) => setArticleUrl(event.target.value)}
                    placeholder="https://example.com/article"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                </div>
              </label>
              <div className="pbk-skill-dialog-grid">
                <label>
                  Who should learn it?
                  <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                    <option value="ava">Ava</option>
                    <option value="rex">Rex</option>
                    <option value="nurture-agent">Nurture</option>
                    <option value="max">Max</option>
                  </select>
                </label>
                <label>
                  How many drafts?
                  <select
                    value={maxCandidates}
                    onChange={(event) => setMaxCandidates(Number(event.target.value))}
                  >
                    <option value={3}>3 focused skills</option>
                    <option value={5}>5 balanced skills</option>
                    <option value={8}>8 broad skills</option>
                  </select>
                </label>
              </div>
              <div className="pbk-skill-youtube-note">
                <ShieldCheck size={18} />
                <div>
                  <strong>Review stays mandatory</strong>
                  <span>
                    Ava can draft from articles or notes, but nothing goes live until a person
                    reviews and approves it.
                  </span>
                </div>
              </div>
              <label className="pbk-skill-article-text">
                Article text, screenshot text, or detailed notes
                <textarea
                  value={articleText}
                  onChange={(event) => setArticleText(event.target.value)}
                  placeholder="Paste the article body, screenshot text, or detailed notes. Ava will draft the situation, response, next question, safety level, and suggested owner."
                  rows={8}
                />
                <small>
                  For screenshots, copy the visible article text here. A URL can be used when the
                  system can fetch the page directly.
                </small>
              </label>
            </>
          )}
        </div>
        <footer>
          <div className="pbk-skill-dialog-footer-left">
            {mode === 'manual' && wizardStep > 0 && (
              <button
                type="button"
                className="pbk-btn pbk-btn-ghost"
                onClick={() => setWizardStep((current) => Math.max(0, current - 1))}
              >
                Back
              </button>
            )}
            <button type="button" className="pbk-btn pbk-btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
          <button
            type="button"
            className="pbk-btn pbk-btn-primary"
            disabled={
              busy ||
              (mode === 'manual'
                ? wizardStep === SKILL_WIZARD_STEPS.length - 1
                  ? !manualCanSave
                  : !manualStepReady
                : mode === 'youtube'
                  ? !/^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(youtubeUrl.trim())
                  : !(articleText.trim().length >= 400 || /^https?:\/\//i.test(articleUrl.trim())))
            }
            onClick={() => {
              if (mode === 'manual' && wizardStep < SKILL_WIZARD_STEPS.length - 1) {
                setWizardStep((current) => Math.min(SKILL_WIZARD_STEPS.length - 1, current + 1));
                return;
              }
              if (mode === 'youtube') {
                void onIngest({
                  sourceType: 'youtube',
                  source: youtubeUrl.trim(),
                  agentId,
                  maxCandidates,
                  manualTranscript: manualTranscript.trim(),
                  audioTranscriptUrl: audioTranscriptUrl.trim(),
                });
                return;
              }
              if (mode === 'article') {
                void onIngest({
                  sourceType: 'article',
                  source: articleUrl.trim(),
                  agentId,
                  maxCandidates,
                  text: articleText.trim(),
                  title: articleTitle.trim(),
                });
                return;
              }
              void onCreate({
                displayName: name.trim(),
                instructions: compiledManualInstructions,
                riskClass,
                agentId,
                source: 'operator',
                triggerPolicy: {
                  triggerType,
                  triggerLabel,
                  nextQuestion: nextQuestion.trim(),
                },
                sourceNote:
                  sourceNote.trim() ||
                  `Created in PBK Skill Studio guided wizard for ${triggerLabel}.`,
              });
            }}
          >
            {mode === 'youtube' ? (
              <Youtube size={17} />
            ) : mode === 'article' ? (
              <FileText size={17} />
            ) : (
              <Plus size={16} />
            )}
            {busy
              ? mode === 'youtube'
                ? 'Analyzing video'
                : mode === 'article'
                  ? 'Analyzing article'
                  : 'Creating'
              : mode === 'youtube'
                ? 'Analyze video'
                : mode === 'article'
                  ? 'Analyze article'
                  : wizardStep === SKILL_WIZARD_STEPS.length - 1
                    ? 'Create candidate'
                    : wizardStep === SKILL_WIZARD_STEPS.length - 2
                      ? 'Preview skill'
                      : 'Next'}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function SkillStudio() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<SkillGovernanceStatusResponse | null>(null);
  const [items, setItems] = useState<SkillGovernanceItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [performanceFilter, setPerformanceFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(searchParams.get('create') === '1');
  const [agentId, setAgentId] = useState('ava');
  const [rolloutPercent, setRolloutPercent] = useState(10);
  const [confirmingPrimaryAction, setConfirmingPrimaryAction] = useState(false);
  const [skillPage, setSkillPage] = useState(0);

  const selected = useMemo(
    () => items.find((item) => item.versionId === selectedId) || null,
    [items, selectedId]
  );
  const currentStep = STATE_STEP[selected?.lifecycleState || 'candidate'] || 0;
  const selectedPerformance = selected ? getSkillPerformance(selected) : null;

  const visibleItems = useMemo(() => {
    const normalizedAgent = agentFilter.trim().toLowerCase();
    const normalizedRisk = riskFilter.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (normalizedAgent && String(item.agentId || '').toLowerCase() !== normalizedAgent) {
        return false;
      }
      if (normalizedRisk && String(item.riskClass || '').toLowerCase() !== normalizedRisk) {
        return false;
      }
      if (performanceFilter === 'needs_outcomes') {
        const metrics = getSkillPerformance(item);
        return metrics.usageCount <= 0 || metrics.successRate === null;
      }
      return true;
    });
    return [...filtered].sort((left, right) => {
      if (performanceFilter === 'top') {
        const leftMetrics = getSkillPerformance(left);
        const rightMetrics = getSkillPerformance(right);
        return (
          (rightMetrics.successRate ?? rightMetrics.confidence ?? -1) -
          (leftMetrics.successRate ?? leftMetrics.confidence ?? -1)
        );
      }
      if (performanceFilter === 'worst') {
        const leftMetrics = getSkillPerformance(left);
        const rightMetrics = getSkillPerformance(right);
        return (
          (leftMetrics.successRate ?? leftMetrics.confidence ?? 101) -
          (rightMetrics.successRate ?? rightMetrics.confidence ?? 101)
        );
      }
      if (performanceFilter === 'recent') {
        return (
          new Date(getSkillPerformance(right).lastTriggeredAt || 0).getTime() -
          new Date(getSkillPerformance(left).lastTriggeredAt || 0).getTime()
        );
      }
      return 0;
    });
  }, [agentFilter, items, performanceFilter, riskFilter]);
  const pagedVisibleItems = useMemo(
    () => getPageSlice(visibleItems, skillPage, OPERATOR_LIST_PAGE_SIZE),
    [skillPage, visibleItems]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statusResult, repositoryResult] = await Promise.all([
        fetchSkillGovernanceStatusRequest(),
        fetchSkillGovernanceRepositoryRequest({
          lifecycleState: lifecycleFilter,
          search,
          limit: 150,
        }),
      ]);
      const nextItems = repositoryResult.items || [];
      setStatus(statusResult);
      setItems(nextItems);
      setSelectedId((current) =>
        nextItems.some((item) => item.versionId === current)
          ? current
          : nextItems[0]?.versionId || ''
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [lifecycleFilter, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    setConfirmingPrimaryAction(false);
  }, [selectedId]);

  useEffect(() => {
    setSkillPage(0);
  }, [agentFilter, lifecycleFilter, performanceFilter, riskFilter, search]);

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(visibleItems.length / OPERATOR_LIST_PAGE_SIZE));
    setSkillPage((current) => Math.min(current, pageCount - 1));
  }, [visibleItems.length]);

  const selectedIsReviewable = Boolean(
    selected &&
    ['candidate', 'needs_review', 'ready_for_approval'].includes(selected.lifecycleState)
  );

  const runAction = async <T,>(
    action: () => Promise<T>,
    success: string | ((result: T) => string)
  ): Promise<T | null> => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      setNotice(typeof success === 'function' ? success(result) : success);
      await load();
      return result;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusy(false);
    }
    return null;
  };

  const closeCreate = () => {
    setCreateOpen(false);
    if (searchParams.get('create')) {
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      setSearchParams(next, { replace: true });
    }
  };

  const primaryAction = !selected
    ? null
    : selectedIsReviewable
      ? {
          label:
            selected.lifecycleState === 'ready_for_approval'
              ? 'Approve this Ava skill'
              : 'Review and approve this skill',
          confirmTitle: 'Approve this skill for Ava?',
          confirmCopy:
            selected.lifecycleState === 'ready_for_approval'
              ? 'This keeps the skill off until you choose a small test. Ava will not use it live yet.'
              : 'This records your review against the exact skill version. Ava will not use it live until you start a small test.',
          icon: FileCheck2,
          run: () =>
            runAction(
              () =>
                approveSkillVersionRequest(selected.versionId, {
                  expectedHash: selected.contentHash,
                  decision: 'approved',
                  evidenceSnapshot: {
                    reviewedIn: 'PBK Skill Studio',
                    riskClass: selected.riskClass,
                    safetyScan: selected.safetyScan || {},
                  },
                }),
              `${selected.name} is approved but remains inactive.`
            ),
        }
      : selected.lifecycleState === 'approved_inactive'
        ? {
            label: 'Start a small test',
            confirmTitle: `Start this skill for ${rolloutPercent}% of ${agentId.toUpperCase()}?`,
            confirmCopy:
              'Ava will only use this in the selected small rollout. If anything looks wrong, roll it back.',
            icon: Sparkles,
            run: () =>
              runAction(
                () =>
                  activateSkillVersionRequest(selected.versionId, {
                    agentId,
                    rolloutMode: rolloutPercent >= 100 ? 'full' : 'canary',
                    rolloutPercent,
                    scope: { type: 'global' },
                    rollbackThresholds: {
                      complianceFailure: 1,
                      sellerComplaint: 1,
                      toolErrorRate: 0.1,
                    },
                  }),
                `${selected.name} is live for ${rolloutPercent}% of ${agentId.toUpperCase()} traffic.`
              ),
          }
        : selected.activationId && ['canary', 'active'].includes(selected.lifecycleState)
          ? {
              label: 'Turn this skill off',
              confirmTitle: 'Turn this skill off for new conversations?',
              confirmCopy:
                'This stops Ava from choosing this skill for new conversations. Past records stay saved.',
              icon: RotateCcw,
              danger: true,
              run: () =>
                runAction(
                  () =>
                    rollbackSkillActivationRequest(selected.activationId as string, {
                      reason: 'Operator rollback from PBK Skill Studio.',
                    }),
                  `${selected.name} was removed from new runtime selections.`
                ),
            }
          : null;

  return (
    <div className="pbk-skill-studio">
      <header className="pbk-skill-studio-header">
        <div>
          <span className="pbk-eyebrow">Ava learning - human approved</span>
          <h1 className="pbk-display">
            Skill <em>Studio</em>
          </h1>
          <p>
            Teach Ava what to say, review what is working, and turn stronger responses on carefully.
          </p>
        </div>
        <div className="pbk-skill-studio-header-actions">
          <button
            type="button"
            className="pbk-btn pbk-btn-ghost"
            onClick={() => void load()}
            disabled={loading}
            title="Refresh Ava skill list"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            type="button"
            className="pbk-btn pbk-btn-primary"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={16} />
            Teach Ava
          </button>
        </div>
      </header>

      <section className="pbk-skill-status-ribbon" aria-label="Skill governance status">
        <div>
          <span>Review queue</span>
          <strong>{status?.candidates || 0}</strong>
        </div>
        <div>
          <span>Ready to test</span>
          <strong>{status?.approvedInactive || 0}</strong>
        </div>
        <div>
          <span>Small test</span>
          <strong>{status?.canary || 0}</strong>
        </div>
        <div>
          <span>Live now</span>
          <strong>{status?.active || 0}</strong>
        </div>
        <div className={status?.outbox?.deadLettered ? 'warning' : ''}>
          <span>Sync health</span>
          <strong>{status?.outbox?.pending || 0}</strong>
          <small>learning records</small>
        </div>
      </section>

      {(error || notice) && (
        <div className={`pbk-skill-banner ${error ? 'error' : 'success'}`}>
          {error ? <AlertTriangle size={16} /> : <Check size={16} />}
          <span>{error || notice}</span>
          <button type="button" onClick={() => (error ? setError('') : setNotice(''))}>
            <X size={15} />
          </button>
        </div>
      )}

      <div className={`pbk-skill-workspace ${selected ? 'has-selection' : ''}`}>
        <aside className="pbk-skill-repository">
          <div className="pbk-skill-pane-head">
            <div>
              <span>Ava skills</span>
              <strong>
                {pagedVisibleItems.length} shown · {visibleItems.length} matching skills
              </strong>
            </div>
            <Database size={17} />
          </div>
          <div className="pbk-skill-search">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search Ava skills or replies"
              aria-label="Search skill repository"
            />
          </div>
          <div className="pbk-skill-filter-grid">
            <label className="pbk-skill-filter">
              <Filter size={15} />
              <select
                value={lifecycleFilter}
                onChange={(event) => setLifecycleFilter(event.target.value)}
                aria-label="Filter by lifecycle state"
              >
                <option value="">All lifecycle states</option>
                {Object.entries(STATE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="pbk-skill-filter">
              <Bot size={15} />
              <select
                value={agentFilter}
                onChange={(event) => setAgentFilter(event.target.value)}
                aria-label="Filter by agent"
              >
                <option value="">All agents</option>
                <option value="ava">Ava</option>
                <option value="rex">Rex</option>
                <option value="nurture-agent">Nurture</option>
                <option value="max">Max</option>
              </select>
            </label>
            <label className="pbk-skill-filter">
              <ShieldCheck size={15} />
              <select
                value={riskFilter}
                onChange={(event) => setRiskFilter(event.target.value)}
                aria-label="Filter by risk"
              >
                <option value="">All risk</option>
                <option value="low">Low risk</option>
                <option value="medium">Medium risk</option>
                <option value="high">High risk</option>
                <option value="critical">Critical risk</option>
              </select>
            </label>
            <label className="pbk-skill-filter">
              <Activity size={15} />
              <select
                value={performanceFilter}
                onChange={(event) => setPerformanceFilter(event.target.value)}
                aria-label="Sort by performance"
              >
                <option value="">All performance</option>
                <option value="top">Top outcomes</option>
                <option value="worst">Needs coaching</option>
                <option value="recent">Recently triggered</option>
                <option value="needs_outcomes">Needs outcome data</option>
              </select>
            </label>
          </div>
          <div className="pbk-skill-list">
            {loading && !items.length ? (
              <div className="pbk-skill-empty">
                <RefreshCw className="animate-spin" />
                Loading authority...
              </div>
            ) : visibleItems.length ? (
              pagedVisibleItems.map((item) => {
                const metrics = getSkillPerformance(item);
                return (
                  <button
                    type="button"
                    key={item.versionId}
                    className={`pbk-skill-list-item ${selected?.versionId === item.versionId ? 'selected' : ''}`}
                    onClick={() => setSelectedId(item.versionId)}
                  >
                    <span className={`pbk-skill-state state-${item.lifecycleState}`}>
                      {STATE_LABELS[item.lifecycleState] || item.lifecycleState}
                    </span>
                    <strong>{item.name}</strong>
                    <span className="pbk-skill-card-badges">
                      <span>v{item.versionNumber || 1}</span>
                      <span>{item.agentId || 'Unassigned'}</span>
                      <span>{item.riskClass || 'medium'} risk</span>
                    </span>
                    <span className="pbk-skill-card-metrics">
                      <span>
                        <strong>{metrics.usageCount}</strong>
                        <small>uses</small>
                      </span>
                      <span>
                        <strong>{percentLabel(metrics.successRate)}</strong>
                        <small>success</small>
                      </span>
                      <span className={`trend-${metrics.trendTone}`}>
                        <strong>{percentLabel(metrics.confidence)}</strong>
                        <small>{signedPercentLabel(metrics.confidenceDelta)}</small>
                      </span>
                    </span>
                    <small>Last triggered: {displayDate(metrics.lastTriggeredAt)}</small>
                  </button>
                );
              })
            ) : (
              <div className="pbk-skill-empty">
                <Search size={18} />
                No Ava skills match this view.
              </div>
            )}
          </div>
          <CompactPager
            page={skillPage}
            total={visibleItems.length}
            label="Ava skill pages"
            itemLabel="skills"
            onPageChange={setSkillPage}
          />
        </aside>

        <main className="pbk-skill-canvas">
          {selected ? (
            <>
              <div className="pbk-skill-mobile-detail-head">
                <button type="button" onClick={() => setSelectedId('')}>
                  <ChevronLeft size={17} />
                  Repository
                </button>
                <button type="button" onClick={() => setInspectorOpen(true)}>
                  <SlidersHorizontal size={17} />
                  Inspect
                </button>
              </div>
              <div className="pbk-skill-version-head">
                <div>
                  <div className="pbk-skill-version-kicker">
                    <span className={`pbk-skill-state state-${selected.lifecycleState}`}>
                      {STATE_LABELS[selected.lifecycleState] || selected.lifecycleState}
                    </span>
                    <span>Version {selected.versionNumber || 1}</span>
                    <span>Saved version</span>
                  </div>
                  <h2>{selected.name}</h2>
                  <p>{selected.instructions || 'No instructions were stored for this version.'}</p>
                </div>
                <div className="pbk-skill-version-icon">
                  <Sparkles size={22} />
                </div>
              </div>

              <ol className="pbk-skill-lifecycle" aria-label="Skill lifecycle">
                {LIFECYCLE_STEPS.map((step, index) => (
                  <li
                    key={step}
                    className={`${index < currentStep ? 'complete' : ''} ${index === currentStep ? 'current' : ''}`}
                  >
                    <span>{index < currentStep ? <Check size={13} /> : index + 1}</span>
                    <strong>{step}</strong>
                  </li>
                ))}
              </ol>

              <section
                className="pbk-skill-performance-dashboard"
                aria-label="Skill performance dashboard"
              >
                <header>
                  <Activity size={17} />
                  <div>
                    <span>What is working</span>
                    <h3>Skill performance</h3>
                  </div>
                </header>
                <div>
                  <article>
                    <span>30d uses</span>
                    <strong>{selectedPerformance?.usageCount || 0}</strong>
                  </article>
                  <article>
                    <span>Success rate</span>
                    <strong>{percentLabel(selectedPerformance?.successRate ?? null)}</strong>
                  </article>
                  <article className={`trend-${selectedPerformance?.trendTone || 'neutral'}`}>
                    <span>Confidence</span>
                    <strong>{percentLabel(selectedPerformance?.confidence ?? null)}</strong>
                    <small>
                      {signedPercentLabel(selectedPerformance?.confidenceDelta ?? null)}
                    </small>
                  </article>
                  <article>
                    <span>Last triggered</span>
                    <strong>{displayDate(selectedPerformance?.lastTriggeredAt)}</strong>
                  </article>
                </div>
              </section>

              <section className="pbk-skill-stage">
                <header>
                  <CircleDot size={17} />
                  <div>
                    <span>Current decision</span>
                    <h3>{LIFECYCLE_STEPS[currentStep]}</h3>
                  </div>
                </header>
                <div className="pbk-skill-stage-grid">
                  <article>
                    <ShieldCheck size={18} />
                    <div>
                      <strong>Safety boundary</strong>
                      <p>
                        New skills stay off until reviewed, so Ava cannot use them before you are
                        comfortable.
                      </p>
                    </div>
                  </article>
                  <article>
                    <GitBranch size={18} />
                    <div>
                      <strong>Chain placement</strong>
                      <p>
                        This skill can stand on its own. If it needs related training later, add it
                        intentionally.
                      </p>
                    </div>
                  </article>
                  <article>
                    <Activity size={18} />
                    <div>
                      <strong>Scenario evidence</strong>
                      <p>
                        {selected.approvalId
                          ? 'Operator approval evidence is attached.'
                          : 'No scenario run is attached yet. Review provenance and safety before approval.'}
                      </p>
                    </div>
                  </article>
                  <article>
                    <Bot size={18} />
                    <div>
                      <strong>Agent scope</strong>
                      <p>
                        {selected.agentId
                          ? `${selected.agentId.toUpperCase()} - ${selected.rolloutPercent || 0}% rollout`
                          : 'Choose an agent when activating this approved version.'}
                      </p>
                    </div>
                  </article>
                </div>
              </section>

              {selected.lifecycleState === 'approved_inactive' && (
                <section className="pbk-skill-rollout">
                  <div>
                    <label>
                      Agent
                      <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                        <option value="ava">Ava</option>
                        <option value="rex">Rex</option>
                        <option value="nurture-agent">Nurture</option>
                        <option value="max">Max</option>
                      </select>
                    </label>
                    <label>
                      Rollout
                      <output>{rolloutPercent}%</output>
                      <input
                        type="range"
                        min="5"
                        max="100"
                        step="5"
                        value={rolloutPercent}
                        onChange={(event) => setRolloutPercent(Number(event.target.value))}
                      />
                    </label>
                  </div>
                  <p>
                    New versions default to a bounded canary. Full activation is explicit at 100%.
                  </p>
                </section>
              )}

              <section className="pbk-skill-outcomes">
                <header>
                  <Activity size={17} />
                  <h3>Outcome readiness</h3>
                </header>
                <div>
                  <span>Runtime state</span>
                  <strong>{selected.activationStatus || 'Not active'}</strong>
                  <span>Rollout</span>
                  <strong>{selected.rolloutPercent || 0}%</strong>
                  <span>Priority</span>
                  <strong>{selected.priority || 100}</strong>
                  <span>Last activation</span>
                  <strong>{displayDate(selected.activatedAt)}</strong>
                </div>
              </section>

              {primaryAction && (
                <div className="pbk-skill-primary-action">
                  <div>
                    <span>Next controlled action</span>
                    <strong>{primaryAction.label}</strong>
                    {confirmingPrimaryAction && (
                      <small>
                        {primaryAction.confirmTitle} {primaryAction.confirmCopy}
                      </small>
                    )}
                  </div>
                  {confirmingPrimaryAction ? (
                    <div className="pbk-skill-primary-confirm">
                      <button
                        type="button"
                        className="pbk-btn pbk-btn-ghost"
                        onClick={() => setConfirmingPrimaryAction(false)}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={`pbk-btn ${
                          primaryAction.danger ? 'pbk-btn-danger' : 'pbk-btn-primary'
                        }`}
                        onClick={() => {
                          setConfirmingPrimaryAction(false);
                          void primaryAction.run();
                        }}
                        disabled={busy}
                      >
                        <primaryAction.icon size={16} />
                        {busy ? 'Working' : 'Confirm'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`pbk-btn ${
                        primaryAction.danger ? 'pbk-btn-danger' : 'pbk-btn-primary'
                      }`}
                      onClick={() => setConfirmingPrimaryAction(true)}
                      disabled={busy}
                    >
                      <primaryAction.icon size={16} />
                      {busy ? 'Working' : primaryAction.label}
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="pbk-skill-empty-canvas">
              <Sparkles size={26} />
              <h2>Select a skill version</h2>
              <p>
                Choose an exact version from the repository to inspect its lifecycle and controls.
              </p>
            </div>
          )}
        </main>

        <aside className={`pbk-skill-studio-inspector ${inspectorOpen ? 'open' : ''}`}>
          <div className="pbk-skill-pane-head">
            <div>
              <span>Skill details</span>
              <strong>{selected ? 'Skill record' : 'Ava learning health'}</strong>
            </div>
            <button
              type="button"
              onClick={() => setInspectorOpen(false)}
              aria-label="Close inspector"
            >
              <X size={17} />
            </button>
          </div>
          {selected ? (
            <>
              <section>
                <h3>
                  <FileCheck2 size={15} />
                  Provenance
                </h3>
                <JsonSummary value={selected.sourceProvenance} />
              </section>
              <section>
                <h3>
                  <ShieldCheck size={15} />
                  Safety scan
                </h3>
                <JsonSummary value={selected.safetyScan} />
              </section>
              <section>
                <h3>
                  <Bot size={15} />
                  Ava access
                </h3>
                <dl className="pbk-skill-inspector-list">
                  <div>
                    <dt>Agent</dt>
                    <dd>{selected.agentId || 'Unassigned'}</dd>
                  </div>
                  <div>
                    <dt>Allowed actions</dt>
                    <dd>{selected.toolAllowlist?.join(', ') || 'No special actions needed'}</dd>
                  </div>
                  <div>
                    <dt>Applies when</dt>
                    <dd>{formatSkillScope(selected.scope)}</dd>
                  </div>
                </dl>
              </section>
              <section>
                <h3>
                  <History size={15} />
                  Audit facts
                </h3>
                <dl className="pbk-skill-inspector-list">
                  <div>
                    <dt>Created</dt>
                    <dd>{displayDate(selected.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Creator</dt>
                    <dd>{selected.createdBy || 'Unknown'}</dd>
                  </div>
                  <div>
                    <dt>Approved</dt>
                    <dd>{displayDate(selected.approvedAt)}</dd>
                  </div>
                  <div>
                    <dt>Reviewer</dt>
                    <dd>{selected.approvedBy || 'Not approved'}</dd>
                  </div>
                </dl>
              </section>
            </>
          ) : (
            <section className="pbk-skill-inspector-empty">
              <ShieldCheck size={22} />
              <strong>Human-approved learning</strong>
              <p>Select a skill to see where it came from, safety notes, and rollout status.</p>
            </section>
          )}
          <section>
            <h3>
              <Database size={15} />
              Learning sync
            </h3>
            <dl className="pbk-skill-inspector-list">
              <div>
                <dt>Saved in</dt>
                <dd>Workspace memory</dd>
              </div>
              <div>
                <dt>Snapshot</dt>
                <dd>{status?.snapshot?.available ? 'Validated' : 'Unavailable'}</dd>
              </div>
              <div>
                <dt>Sync</dt>
                <dd>{status?.outbox?.deadLettered ? 'Needs attention' : 'Healthy'}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

      <CreateCandidateDialog
        open={createOpen}
        busy={busy}
        onClose={closeCreate}
        onCreate={async (payload) => {
          const result = await runAction(
            () => createSkillCandidateRequest(payload),
            'Candidate created. Review is required before approval or activation.'
          );
          if (result) closeCreate();
        }}
        onIngest={async (payload) => {
          const result = await runAction(
            () => ingestSkillCandidatesRequest(payload),
            (response) =>
              `${response.createdCount || 0} governed candidate${
                response.createdCount === 1 ? '' : 's'
              } created from ${
                response.sourceType === 'article' || payload.sourceType === 'article'
                  ? 'article text'
                  : 'YouTube'
              }. Review is required before activation.`
          );
          if (result) closeCreate();
        }}
      />
    </div>
  );
}
