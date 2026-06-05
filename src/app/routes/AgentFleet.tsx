import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronUp, Loader2, Phone, X } from 'lucide-react';
import { showUiToast } from '../utils/uiFeedback';
import { PbkDataSource } from '../../components/pbk/index';
import {
  fetchAgentHealthRequest,
  fetchRuntimeState,
  fetchRuntimeToolingStatus,
  getSnnWorkerStatus,
  invokeRuntimeTool,
  startLeadCallRequest,
  type AgentHealthProbe,
} from '../utils/runtimeBridge';
import { AGENT_REGISTRY, type RegistryAgent } from '../utils/agentRegistry';

type AgentSkill = {
  name: string;
  source: string;
  confidence: number;
  usage: string;
  success: string;
  transferHistory?: Array<{ toNames: string[]; at: string; versioned: boolean }>;
};

type FleetAgent = RegistryAgent & {
  skills: AgentSkill[];
};

type PendingTransfer = {
  skillName: string;
  skillSource: string;
  fromAgentId: string;
  toAgentIds: string[];
  versioned: boolean;
  queuedAt: string;
  retries: number;
};

type RuntimeLeadOption = {
  id?: string;
  leadId?: string;
  leadName?: string;
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  seller?: { name?: string; phone?: string; email?: string };
  property?: { address?: string };
  selectedPath?: string;
  selected_path?: string;
};

type RuntimeCallRecord = Record<string, unknown>;

type BridgeSnnWorker = {
  agentId?: string;
  name?: string;
  status?: string;
  ready?: boolean;
  lastActive?: string;
  currentTask?: string;
  note?: string;
  spikeSources?: Array<{ name?: string; count?: number; ready?: boolean }>;
};

function getCallAgentId(call: RuntimeCallRecord) {
  return String(call.agentId || call.agent_id || call.agent || call.agentName || '').toLowerCase();
}

function getCallTimestamp(call: RuntimeCallRecord) {
  const value = String(call.endedAt || call.completedAt || call.createdAt || call.startedAt || '');
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getCallOutcomeSummary(call: RuntimeCallRecord) {
  return String(
    call.outcome ||
      call.outcomeLabel ||
      call.outcome_label ||
      call.disposition ||
      call.summary ||
      call.status ||
      'No disposition reported'
  ).replace(/_/g, ' ');
}

type AgentDealPreview = {
  result?: string;
  writeMode?: string;
  summary?: string;
  recommendedAction?: string;
  confidence?: number;
  requiredApprovals?: string[];
  reasoning?: string[];
  selectedPath?: string;
  lead?: {
    leadId?: string;
    leadName?: string;
    address?: string;
    found?: boolean;
  };
  bant?: {
    complete?: boolean;
    missing?: string[];
  };
  analyzer?: {
    found?: boolean;
    arv?: number;
    mao?: number;
    targetOffer?: number;
    repairs?: number;
  };
  safety?: {
    note?: string;
  };
};

const AGENT_SKILLS: Record<string, AgentSkill[]> = {
  ava: [
    {
      name: 'Tactical Empathy',
      source: 'Voss - NSTD',
      confidence: 94,
      usage: '187x',
      success: '71%',
    },
    { name: 'Mirroring', source: 'Audiobook', confidence: 88, usage: '142x', success: '68%' },
    {
      name: 'Ackerman Negotiation v3',
      source: 'self-programmed',
      confidence: 71,
      usage: '23x',
      success: '52%',
    },
    { name: 'Silence Hold', source: '48 Laws - ch 28', confidence: 28, usage: '0x', success: '-' },
  ],
  rex: [
    {
      name: 'Revenue Gap Scan',
      source: 'PBK runtime',
      confidence: 91,
      usage: '42x',
      success: '76%',
    },
  ],
  max: [
    {
      name: 'Pattern Tagging',
      source: 'call outcomes',
      confidence: 84,
      usage: '66x',
      success: '61%',
    },
  ],
  'prosody-tuner': [
    {
      name: 'Calm Downshift',
      source: 'voice trials',
      confidence: 79,
      usage: '51x',
      success: '58%',
    },
  ],
};

function buildFleetAgents(): FleetAgent[] {
  return AGENT_REGISTRY.map((agent) => ({
    ...agent,
    skills: (AGENT_SKILLS[agent.id] || []).map((s) => ({ ...s })),
  }));
}

function mergeAgentStatuses(
  agents: FleetAgent[],
  bridgeAgents: Array<Record<string, unknown>>
): FleetAgent[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  for (const ba of bridgeAgents) {
    const id = String(ba.id || ba.agentId || ba.name || '').toLowerCase();
    const existing = byId.get(id);
    if (existing) {
      const s = String(ba.status || existing.status).toLowerCase();
      existing.status = (
        ['active', 'standby', 'inactive'].includes(s) ? s : existing.status
      ) as FleetAgent['status'];
    }
  }
  return [...byId.values()];
}

function normalizeFleetAgentId(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function getLeadOptionId(lead: RuntimeLeadOption) {
  return String(lead.leadId || lead.id || lead.phone || lead.address || '').trim();
}

function getLeadOptionLabel(lead: RuntimeLeadOption) {
  const name = lead.leadName || lead.name || lead.seller?.name || 'Unknown seller';
  const address = lead.address || lead.property?.address || 'Unknown property';
  return `${name} - ${address}`;
}

function getLeadOptionName(lead: RuntimeLeadOption) {
  return String(lead.leadName || lead.name || lead.seller?.name || 'Unknown seller');
}

function getLeadOptionAddress(lead: RuntimeLeadOption) {
  return String(lead.address || lead.property?.address || 'Unknown property');
}

function getLeadOptionPhone(lead: RuntimeLeadOption) {
  return String(lead.phone || lead.seller?.phone || '').trim();
}

function normalizePhone(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function assertBridgeTransferApplied(result: unknown, skillName = 'skill') {
  const response = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  if (response.ok === false) {
    throw new Error(String(response.error || `${skillName} transfer failed.`));
  }
  const statusText = String(
    response.result || response.status || response.outcome || ''
  ).toLowerCase();
  if (/failed|error|rejected|not[_-]?applied/.test(statusText)) {
    throw new Error(
      String(response.error || `${skillName} transfer was not applied by the bridge.`)
    );
  }
  const confirmed =
    response.ok === true ||
    Boolean(
      response.transferId ||
      response.transfer_id ||
      response.state ||
      response.skill ||
      response.updatedAgents
    ) ||
    /transferred|applied|copied|delivered|queued/.test(statusText);
  if (!confirmed) {
    throw new Error(`Bridge did not confirm '${skillName}' was applied.`);
  }
}

function getBridgeSnnWorkerForAgent(workers: BridgeSnnWorker[], agentId = '') {
  const normalized = normalizeFleetAgentId(agentId);
  return workers.find(
    (worker) => normalizeFleetAgentId(worker.agentId || worker.name || '') === normalized
  );
}

function getHealthProbeForAgent(probes: AgentHealthProbe[], agent: FleetAgent) {
  const id = normalizeFleetAgentId(agent.id);
  const name = normalizeFleetAgentId(agent.name);
  return probes.find((probe) => {
    const probeId = normalizeFleetAgentId(probe.id || '');
    const probeName = normalizeFleetAgentId(probe.name || '');
    return probeId === id || probeName === id || probeId === name || probeName === name;
  });
}

function formatAgentPreviewAction(value = '') {
  return String(value || 'inspect_lead_profile').replace(/_/g, ' ');
}

function getAgentActivityState(agent: FleetAgent, bridgeWorker?: BridgeSnnWorker) {
  if (bridgeWorker?.currentTask || bridgeWorker?.status === 'running') return 'learning';
  if (agent.metadata.approvalGated) return 'running_campaign';
  if (agent.status === 'active') return 'active';
  if (agent.status === 'standby') return 'learning';
  return 'idle';
}

function getAgentDeployClass(agent: FleetAgent) {
  if (agent.status === 'active') return 'production';
  if (agent.status === 'standby') return 'local';
  return 'offline';
}

function getAgentSummary(agent: FleetAgent, lastOutcome: string, bridgeWorker?: BridgeSnnWorker) {
  if (bridgeWorker?.currentTask) return bridgeWorker.currentTask;
  if (lastOutcome && lastOutcome !== 'No call outcome yet') return `Last call: ${lastOutcome}`;
  if (agent.metadata.approvalGated) return 'Approval-gated provider actions available';
  if (agent.metadata.suggestOnly) return 'Suggest-only analysis lane';
  return agent.description;
}

function countSkills(agents: FleetAgent[]) {
  return agents.reduce((total, agent) => total + agent.skills.length, 0);
}

async function flushTransferQueue(queue: PendingTransfer[], agents: FleetAgent[]) {
  const retryable = queue.filter((t) => t.retries < 3);
  for (const transfer of [...retryable]) {
    const toNames = agents
      .filter((a) => transfer.toAgentIds.includes(a.id))
      .map((a) => a.name)
      .join(', ');
    try {
      const result = await invokeRuntimeTool('pbk_transfer_agent_skill', {
        skillName: transfer.skillName,
        skillSource: transfer.skillSource,
        fromAgentId: transfer.fromAgentId,
        toAgentIds: transfer.toAgentIds,
        versioned: transfer.versioned,
        requestedBy: 'AgentFleet UI (retry)',
      });
      assertBridgeTransferApplied(result, transfer.skillName);
      const idx = queue.indexOf(transfer);
      if (idx >= 0) queue.splice(idx, 1);
      showUiToast({
        tone: 'success',
        title: 'Queued transfer sent',
        desc: `'${transfer.skillName}' delivered to ${toNames}`,
      });
    } catch (error) {
      console.warn('[PBK AgentFleet] queued skill transfer retry failed', {
        skillName: transfer.skillName,
        fromAgentId: transfer.fromAgentId,
        toAgentIds: transfer.toAgentIds,
        error: error instanceof Error ? error.message : String(error),
      });
      transfer.retries += 1;
      if (transfer.retries >= 3) {
        const idx = queue.indexOf(transfer);
        if (idx >= 0) queue.splice(idx, 1);
        showUiToast({
          tone: 'error',
          title: 'Transfer dropped',
          desc: `'${transfer.skillName}' to ${toNames} failed after 3 attempts.`,
        });
      }
    }
  }
}

// ---------- Sub-components ----------

function AgentFleetSourceRail() {
  return (
    <div className="pbk-fleet-source-rail" aria-label="Agent Fleet data sources">
      <PbkDataSource endpoint="GET /api/tooling/status" status="ships" />
      <PbkDataSource endpoint="GET /api/agents/health" status="ships" />
      <PbkDataSource endpoint="GET /state" status="ships" />
      <PbkDataSource endpoint="POST /invoke: getSnnWorkerStatus" status="ships" />
      <PbkDataSource endpoint="POST /invoke: previewAgentDealContext" status="ships" />
      <PbkDataSource endpoint="POST /invoke: pbk_transfer_agent_skill" status="ships" />
      <PbkDataSource endpoint="POST /invoke: telnyx_call" status="ships" />
      <PbkDataSource
        endpoint="GET /api/agents/registry"
        status="needs-wiring"
        note="canonical remote registry if agents move out of the bridge process"
      />
      <PbkDataSource
        endpoint="GET /api/agents/snn-status"
        status="needs-wiring"
        note="durable SNN state beyond local worker and invoke status"
      />
    </div>
  );
}

function AgentFleetHero({
  agents,
  bridgeConnected,
  pendingTransferCount,
  leadCount,
  callCount,
}: {
  agents: FleetAgent[];
  bridgeConnected: boolean | null;
  pendingTransferCount: number;
  leadCount: number;
  callCount: number;
}) {
  const active = agents.filter((agent) => agent.status === 'active').length;
  const standby = agents.filter((agent) => agent.status === 'standby').length;
  const inactive = agents.filter((agent) => agent.status === 'inactive').length;
  const bridgeLabel =
    bridgeConnected === null ? 'Connecting' : bridgeConnected ? 'Bridge live' : 'Bridge offline';

  return (
    <section className="pbk-fleet-hero">
      <div className="pbk-fleet-hero-top">
        <div>
          <div className="pbk-eyebrow">
            Agent Fleet - {active} active - {standby} standby - {inactive} inactive
          </div>
          <h1 className="pbk-display pbk-h1">
            The <em>agent fleet</em>.
          </h1>
          <p>
            Every PBK agent at a glance: bridge health, SNN readiness, live lead context, skill
            transfer safety, and approval-gated provider actions in one command surface.
          </p>
        </div>
        <div className="pbk-fleet-bridge-card">
          <span className={bridgeConnected ? 'live' : bridgeConnected === false ? 'warn' : ''} />
          <strong>{bridgeLabel}</strong>
          <small>
            {pendingTransferCount
              ? `${pendingTransferCount} queued transfer retries`
              : 'No queued transfers'}
          </small>
        </div>
      </div>

      <div className="pbk-stats-ribbon">
        <div className="pbk-stat">
          <div className="pbk-stat-label">Agents</div>
          <div className="pbk-stat-value">{agents.length}</div>
        </div>
        <div className="pbk-stat">
          <div className="pbk-stat-label">Skills loaded</div>
          <div className="pbk-stat-value">{countSkills(agents)}</div>
        </div>
        <div className="pbk-stat">
          <div className="pbk-stat-label">Lead context</div>
          <div className="pbk-stat-value">{leadCount}</div>
        </div>
        <div className="pbk-stat">
          <div className="pbk-stat-label">Call outcomes</div>
          <div className="pbk-stat-value">{callCount}</div>
        </div>
      </div>

      <AgentFleetSourceRail />
    </section>
  );
}

function AgentFleetCard({
  agent,
  selected,
  bridgeWorker,
  healthProbe,
  localSnnActive,
  transferFeedback,
  lastOutcome,
  onSelect,
}: {
  agent: FleetAgent;
  selected: boolean;
  bridgeWorker?: BridgeSnnWorker;
  healthProbe?: AgentHealthProbe;
  localSnnActive: boolean;
  transferFeedback?: string;
  lastOutcome: string;
  onSelect: () => void;
}) {
  const activityState = getAgentActivityState(agent, bridgeWorker);
  const ready = localSnnActive || Boolean(bridgeWorker?.ready);
  const healthReady = Boolean(healthProbe?.ready);
  const healthState = healthProbe ? (healthReady ? 'ready' : 'degraded') : 'local';
  const missingTools = Array.isArray(healthProbe?.missingTools) ? healthProbe.missingTools : [];
  const healthSource = healthProbe
    ? healthProbe.healthProbe || healthProbe.source || 'GET /api/agents/health'
    : 'local registry';
  const healthLastSeen = healthProbe?.lastSeen
    ? formatAgentPreviewAction(healthProbe.lastSeen)
    : '';
  const topSkills = agent.skills.slice(0, 3);
  return (
    <article className={`pbk-agent-card ${selected ? 'selected' : ''}`.trim()}>
      <button type="button" className="pbk-agent-card-button" onClick={onSelect}>
        <span className="pbk-agent-card-head">
          <span className="pbk-agent-avatar-wrap">
            <span
              className={`pbk-agent-avatar ${agent.id === 'rex' ? 'purple' : agent.id === 'max' ? 'amber' : agent.id === 'nurture-agent' ? 'lime' : ''}`.trim()}
            >
              {agent.initial}
            </span>
            <span className={`pbk-agent-status-dot ${activityState}`} />
          </span>
          <span className="pbk-agent-id">
            <span className="name">
              <em>{agent.name}</em>
            </span>
            <span className="role">
              {agent.role} - {agent.version}
            </span>
          </span>
          <span className={`pbk-agent-deploy-pill ${getAgentDeployClass(agent)}`}>
            {agent.status === 'active' ? 'production' : agent.status}
          </span>
        </span>

        <span className={`pbk-agent-activity ${activityState}`}>
          <strong>{getAgentSummary(agent, lastOutcome, bridgeWorker)}</strong>
          <span>
            {ready ? 'SNN ready' : 'SNN local status pending'} -{' '}
            {agent.metadata.orchestrationRole || 'worker'}
          </span>
          <span className="sentiment-line">
            <span>Confidence lane</span>
            <span className="sentiment-bar">
              <span
                className="sentiment-fill"
                style={{ width: `${Math.min(96, 44 + agent.skills.length * 11)}%` }}
              />
            </span>
          </span>
        </span>

        <span className="pbk-agent-health-strip" data-source="GET /api/agents/health">
          <span className={`pbk-agent-health-state ${healthState}`}>
            {healthState === 'ready'
              ? 'health ready'
              : healthState === 'degraded'
                ? 'degraded'
                : 'local catalog'}
          </span>
          <span>{missingTools.length ? `${missingTools.length} tool gaps` : 'tools clear'}</span>
          <span className="pbk-agent-health-source" title={healthSource}>
            {healthSource}
          </span>
          {healthLastSeen && <span title={healthProbe?.lastSeen}>seen {healthLastSeen}</span>}
        </span>

        <span className="pbk-agent-skill-chips">
          {topSkills.length ? (
            topSkills.map((skill) => (
              <span
                key={skill.name}
                className={`pbk-agent-skill-chip ${skill.confidence >= 80 ? 'proven' : skill.confidence >= 60 ? 'evolving' : ''}`.trim()}
              >
                {skill.name} - {skill.confidence}%
              </span>
            ))
          ) : (
            <span className="pbk-agent-skill-chip">No skills recorded</span>
          )}
        </span>

        <span className="pbk-agent-meta">
          <span>
            {agent.skills.length} skills - {agent.capabilities.length} capabilities
          </span>
          <span title={lastOutcome}>{lastOutcome}</span>
        </span>
      </button>
      {transferFeedback && (
        <span className="pbk-agent-transfer-ok">
          <Check size={11} />
          {transferFeedback}
        </span>
      )}
    </article>
  );
}

function AgentDetailPanel({ children }: { children: ReactNode }) {
  return <section className="pbk-agent-detail-panel">{children}</section>;
}

interface SkillTransferModalProps {
  skill: AgentSkill;
  currentAgentId: string;
  agents: FleetAgent[];
  onClose: () => void;
  onTransfer: (targetAgentIds: string[], versioned: boolean) => Promise<void>;
}

function SkillTransferModal({
  skill,
  currentAgentId,
  agents,
  onClose,
  onTransfer,
}: SkillTransferModalProps) {
  const targets = useMemo(
    () => agents.filter((a) => a.id !== currentAgentId),
    [agents, currentAgentId]
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [versioned, setVersioned] = useState(true);
  const [transferring, setTransferring] = useState(false);
  const [confirmingTransfer, setConfirmingTransfer] = useState(false);
  const selectedTargets = useMemo(
    () => agents.filter((agent) => selectedIds.includes(agent.id)),
    [agents, selectedIds]
  );

  const toggle = (id: string) =>
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const executeTransfer = async () => {
    setConfirmingTransfer(false);
    setTransferring(true);
    await onTransfer(selectedIds, versioned);
    setTransferring(false);
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal skill-transfer-modal relative"
        role="dialog"
        aria-modal="true"
        aria-label="Transfer skill"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <div className="modal-kicker">Skill transfer</div>
            <h3>{skill.name}</h3>
            <p>
              {skill.source} — {skill.confidence}% confidence
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-2">
          {targets.map((agent) => {
            const checked = selectedIds.includes(agent.id);
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => toggle(agent.id)}
                className={['transfer-agent-row', checked ? 'is-selected' : ''].join(' ')}
              >
                <span className="agent-avatar">{agent.initial}</span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-sm font-semibold text-slate-100">{agent.name}</span>
                  <span className="block text-xs text-slate-500">{agent.role}</span>
                </span>
                <span className="transfer-check" aria-hidden="true">
                  {checked && <Check size={14} />}
                </span>
              </button>
            );
          })}
        </div>

        <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/10 px-3 py-3 text-sm text-sky-100">
          <span>
            <span className="block font-semibold">Version this skill</span>
            <span className="text-xs text-sky-200/75">
              Keeps rollback path and outcome history separate.
            </span>
          </span>
          <input
            type="checkbox"
            checked={versioned}
            onChange={(e) => setVersioned(e.target.checked)}
            className="h-5 w-5 accent-sky-400"
          />
        </label>

        {skill.transferHistory && skill.transferHistory.length > 0 && (
          <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
              Transfer history
            </div>
            {skill.transferHistory.map((h) => (
              <div key={h.at} className="flex items-center gap-2 text-[11px] text-slate-400 py-0.5">
                <span className="text-slate-500">{new Date(h.at).toLocaleDateString()}</span>
                <span>→ {h.toNames.join(', ')}</span>
                {h.versioned && (
                  <span className="rounded bg-sky-500/20 px-1 text-sky-300">versioned</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="modal-footer">
          <span className="text-xs text-slate-500">
            {selectedIds.length} target agent{selectedIds.length === 1 ? '' : 's'} selected
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!selectedIds.length || transferring}
              title={
                !selectedIds.length
                  ? 'Select at least one target agent to transfer'
                  : transferring
                    ? 'Transfer in progress…'
                    : undefined
              }
              onClick={() => setConfirmingTransfer(true)}
            >
              {transferring ? 'Transferring…' : 'Transfer skill'}
            </button>
          </div>
        </div>

        {confirmingTransfer && (
          <div className="absolute inset-0 z-10 grid place-items-center rounded-[inherit] bg-slate-950/85 p-4 backdrop-blur-sm">
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="skill-transfer-confirm-title"
              className="w-full max-w-sm rounded-2xl border border-sky-500/20 bg-slate-950 p-4 shadow-2xl"
            >
              <div className="text-[11px] uppercase tracking-[0.16em] text-sky-300">
                Transfer safety check
              </div>
              <h4
                id="skill-transfer-confirm-title"
                className="mt-2 text-base font-semibold text-slate-100"
              >
                Transfer this skill?
              </h4>
              <p className="mt-2 text-sm text-slate-400">
                {skill.name} will be copied to{' '}
                <span className="font-semibold text-slate-200">
                  {selectedTargets.map((agent) => agent.name).join(', ')}
                </span>
                {versioned ? ' as a versioned transfer.' : '.'}
              </p>
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirmingTransfer(false)}
                >
                  Cancel
                </button>
                <button type="button" className="btn-primary" onClick={executeTransfer}>
                  Confirm transfer
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TestSkillPanel({
  skill,
  agentId,
  onClose,
}: {
  skill: AgentSkill;
  agentId: string;
  onClose: () => void;
}) {
  const [scenario, setScenario] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const runTest = async () => {
    if (!scenario.trim()) return;
    setTesting(true);
    setResult(null);
    try {
      const res = await invokeRuntimeTool<Record<string, unknown>>('pbk_test_skill', {
        skillName: skill.name,
        skillSource: skill.source,
        agentId,
        scenario: scenario.trim(),
      });
      setResult(String(res?.result ?? res?.response ?? res?.output ?? JSON.stringify(res)));
    } catch (error) {
      console.warn('[PBK AgentFleet] skill test failed', {
        skillName: skill.name,
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      setResult(
        error instanceof Error
          ? error.message
          : 'Bridge unavailable - cannot run live test right now.'
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-slate-700 bg-slate-900/80 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Test against scenario
        </span>
        <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300">
          <X size={13} />
        </button>
      </div>
      <textarea
        className="w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:border-sky-500/60 focus:outline-none"
        rows={3}
        placeholder={`e.g. "Seller insists property is worth $200k. We're at $120k. They seem frustrated."`}
        value={scenario}
        onChange={(e) => setScenario(e.target.value)}
      />
      <div className="mt-2 flex items-start gap-3">
        <button
          type="button"
          className="btn-primary flex shrink-0 items-center gap-1.5 text-xs"
          disabled={!scenario.trim() || testing}
          onClick={runTest}
        >
          {testing ? <Loader2 size={11} className="animate-spin" /> : null}
          {testing ? 'Testing…' : 'Run test'}
        </button>
        {result && <p className="min-w-0 text-xs text-slate-400 leading-relaxed">{result}</p>}
      </div>
    </div>
  );
}

function ExamplePanel({ skill, agent }: { skill: AgentSkill; agent: FleetAgent }) {
  const relevant = agent.capabilities.slice(0, 6);
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-slate-700 bg-slate-900/80 p-3 text-xs">
      <div>
        <div className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-500">Source</div>
        <p className="text-slate-300">{skill.source}</p>
      </div>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
          Agent capabilities
        </div>
        <div className="flex flex-wrap gap-1">
          {relevant.map((cap) => (
            <span
              key={cap}
              className="rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300"
            >
              {cap.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-slate-600">
        Live outcome examples load when bridge is connected.
      </p>
    </div>
  );
}

function FleetLoadingSkeleton() {
  return (
    <div className="fleet-loading-skeleton grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-slate-800" />
            <div className="min-w-0 flex-1">
              <div className="h-4 w-28 rounded-full bg-slate-800" />
              <div className="mt-2 h-3 w-40 rounded-full bg-slate-800" />
            </div>
          </div>
          <div className="mt-4 h-3 w-full rounded-full bg-slate-800" />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="h-12 rounded-xl bg-slate-900" />
            <div className="h-12 rounded-xl bg-slate-900" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Main component ----------

export function AgentFleet() {
  const [agents, setAgents] = useState<FleetAgent[]>(buildFleetAgents);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [bridgeConnected, setBridgeConnected] = useState<boolean | null>(null);
  const [activeAgentId, setActiveAgentId] = useState('ava');
  const [selectedSkill, setSelectedSkill] = useState<AgentSkill | null>(null);
  const [expandedExample, setExpandedExample] = useState<string | null>(null);
  const [testingSkill, setTestingSkill] = useState<string | null>(null);
  const [snnStatus, setSnnStatus] = useState<{ ava: boolean; rex: boolean }>({
    ava: false,
    rex: false,
  });
  const [bridgeSnnWorkers, setBridgeSnnWorkers] = useState<BridgeSnnWorker[]>([]);
  const [agentHealthProbes, setAgentHealthProbes] = useState<AgentHealthProbe[]>([]);
  const [leadOptions, setLeadOptions] = useState<RuntimeLeadOption[]>([]);
  const [runtimeCalls, setRuntimeCalls] = useState<RuntimeCallRecord[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [dealPreview, setDealPreview] = useState<AgentDealPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [callActionPending, setCallActionPending] = useState(false);
  const [transferStatus, setTransferStatus] = useState('');
  const [transferFeedbackByAgentId, setTransferFeedbackByAgentId] = useState<
    Record<string, string>
  >({});
  const [pendingTransferCount, setPendingTransferCount] = useState(0);
  const pendingTransferQueueRef = useRef<PendingTransfer[]>([]);
  const transferFeedbackTimersRef = useRef<number[]>([]);
  const syncPendingTransferCount = useCallback(() => {
    setPendingTransferCount(pendingTransferQueueRef.current.length);
  }, []);

  useEffect(() => {
    setSnnStatus(getSnnWorkerStatus());
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      invokeRuntimeTool<{ workers?: BridgeSnnWorker[] }>('getSnnWorkerStatus', {}),
      fetchRuntimeState(),
    ]).then(([snnResult, stateResult]) => {
      if (cancelled) return;
      if (snnResult.status === 'fulfilled') {
        setBridgeSnnWorkers(Array.isArray(snnResult.value.workers) ? snnResult.value.workers : []);
      } else {
        console.warn('[PBK AgentFleet] SNN worker status unavailable', snnResult.reason);
      }
      if (stateResult.status === 'fulfilled') {
        const leads = Array.isArray(stateResult.value.leadImports)
          ? (stateResult.value.leadImports as RuntimeLeadOption[])
          : [];
        const calls = Array.isArray(stateResult.value.calls)
          ? (stateResult.value.calls as RuntimeCallRecord[])
          : [];
        setLeadOptions(leads.slice(0, 25));
        setRuntimeCalls(calls);
        if (!selectedLeadId && leads[0]) setSelectedLeadId(getLeadOptionId(leads[0]));
      } else {
        console.warn('[PBK AgentFleet] lead context options unavailable', stateResult.reason);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedLeadId]);

  useEffect(() => {
    let cancelled = false;
    setAgentsLoading(true);
    Promise.allSettled([fetchRuntimeToolingStatus(), fetchAgentHealthRequest()])
      .then(([toolingResult, healthResult]) => {
        if (cancelled) return;
        let bridgeAgents: Array<Record<string, unknown>> = [];
        if (toolingResult.status === 'fulfilled') {
          const raw = toolingResult.value as Record<string, unknown>;
          bridgeAgents = Array.isArray(raw.agents)
            ? (raw.agents as Array<Record<string, unknown>>)
            : [];
        } else {
          console.warn('[PBK AgentFleet] tooling status unavailable', toolingResult.reason);
        }
        if (healthResult.status === 'fulfilled') {
          setAgentHealthProbes(
            Array.isArray(healthResult.value.agents) ? healthResult.value.agents : []
          );
        } else {
          console.warn('[PBK AgentFleet] agent health unavailable', healthResult.reason);
          setAgentHealthProbes([]);
        }
        if (toolingResult.status === 'fulfilled' || healthResult.status === 'fulfilled') {
          setAgents((prev) => {
            const merged = mergeAgentStatuses(prev, bridgeAgents);
            flushTransferQueue(pendingTransferQueueRef.current, merged)
              .catch((error) => {
                console.warn('[PBK AgentFleet] queued skill transfer flush failed', error);
                if (!cancelled) {
                  showUiToast({
                    tone: 'warning',
                    title: 'Transfer retry failed',
                    desc:
                      error instanceof Error
                        ? error.message
                        : 'Queued skill transfer could not reach the bridge.',
                  });
                }
              })
              .finally(() => {
                if (!cancelled) syncPendingTransferCount();
              });
            return merged;
          });
          setBridgeConnected(true);
        } else {
          setBridgeConnected(false);
          setPreviewError(
            toolingResult.reason instanceof Error
              ? toolingResult.reason.message
              : 'Agent registry could not reach the bridge.'
          );
          showUiToast({
            tone: 'warning',
            title: 'Bridge offline',
            desc: 'Agent Fleet showing cached registry data. Skill transfers will queue.',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setAgentsLoading(false);
      });
    return () => {
      cancelled = true;
      pendingTransferQueueRef.current = [];
      transferFeedbackTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      transferFeedbackTimersRef.current = [];
    };
  }, [syncPendingTransferCount]);

  const activeAgent = useMemo(
    () => agents.find((a) => a.id === activeAgentId) ?? agents[0],
    [activeAgentId, agents]
  );
  const lastCallOutcomeByAgentId = useMemo(() => {
    const ordered = [...runtimeCalls].sort(
      (left, right) => getCallTimestamp(right) - getCallTimestamp(left)
    );
    return agents.reduce<Record<string, string>>((summary, agent) => {
      const match = ordered.find((call) => {
        const agentKey = getCallAgentId(call);
        return agentKey === agent.id || agentKey === agent.name.toLowerCase();
      });
      summary[agent.id] = match ? getCallOutcomeSummary(match) : 'No call outcome yet';
      return summary;
    }, {});
  }, [agents, runtimeCalls]);
  const selectedLead = useMemo(
    () => leadOptions.find((lead) => getLeadOptionId(lead) === selectedLeadId) || null,
    [leadOptions, selectedLeadId]
  );
  const activeBridgeWorker = getBridgeSnnWorkerForAgent(bridgeSnnWorkers, activeAgent.id);
  const activeLocalSnn =
    (activeAgent.id === 'ava' && snnStatus.ava) || (activeAgent.id === 'rex' && snnStatus.rex);
  const activeActivityState = getAgentActivityState(activeAgent, activeBridgeWorker);

  useEffect(() => {
    setDealPreview(null);
    setPreviewError('');
  }, [activeAgentId, selectedLeadId]);

  const handlePreviewAgentDealContext = async () => {
    if (!selectedLead) {
      showUiToast({
        tone: 'warning',
        title: 'Select a lead',
        desc: 'Choose a live lead before previewing agent behavior.',
      });
      return;
    }
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const result = await invokeRuntimeTool<AgentDealPreview>('previewAgentDealContext', {
        agentId: activeAgent.id,
        agentName: activeAgent.name,
        leadId: getLeadOptionId(selectedLead),
        leadName: selectedLead.leadName || selectedLead.name || selectedLead.seller?.name || '',
        address: selectedLead.address || selectedLead.property?.address || '',
        phone: selectedLead.phone || selectedLead.seller?.phone || '',
        email: selectedLead.email || selectedLead.seller?.email || '',
        selectedPath: selectedLead.selectedPath || selectedLead.selected_path || '',
      });
      setDealPreview(result);
    } catch (error) {
      console.warn('[PBK AgentFleet] deal context preview failed', error);
      setPreviewError(
        error instanceof Error
          ? error.message
          : 'Agent deal context preview could not reach the bridge.'
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCallSelectedLead = async () => {
    if (!selectedLead) {
      showUiToast({
        tone: 'warning',
        title: 'Select a lead',
        desc: 'Choose a live lead before requesting a call.',
      });
      return;
    }
    const phone = getLeadOptionPhone(selectedLead);
    if (normalizePhone(phone).length < 10) {
      showUiToast({
        tone: 'error',
        title: 'Call blocked',
        desc: `${getLeadOptionName(selectedLead)} needs a valid phone number before Telnyx can dial.`,
      });
      return;
    }
    setCallActionPending(true);
    try {
      const response = await startLeadCallRequest({
        leadId: getLeadOptionId(selectedLead),
        leadName: getLeadOptionName(selectedLead),
        phone,
        email: selectedLead.email || selectedLead.seller?.email || '',
        address: getLeadOptionAddress(selectedLead),
        agentId: activeAgent.id,
        agentName: activeAgent.name,
        source: 'agent-fleet',
      });
      const status = String(
        response.status || response.result || response.outcome || ''
      ).toLowerCase();
      const approvalQueued =
        status.includes('approval') || Boolean(response.approvalId || response.approval_id);
      showUiToast({
        tone: approvalQueued ? 'info' : 'success',
        title: approvalQueued ? 'Call queued for approval' : 'Call request sent',
        desc: approvalQueued
          ? `${getLeadOptionName(selectedLead)} needs approval before Telnyx dials.`
          : `${getLeadOptionName(selectedLead)} was handed to the Telnyx call lane.`,
      });
    } catch (error) {
      showUiToast({
        tone: 'error',
        title: 'Call request failed',
        desc:
          error instanceof Error ? error.message : 'The bridge did not accept the call request.',
        critical: true,
      });
    } finally {
      setCallActionPending(false);
    }
  };

  const handleTransfer = async (targetAgentIds: string[], versioned: boolean) => {
    if (!selectedSkill) return;
    setTransferStatus('Confirming skill transfer with bridge...');
    const targetNames = agents
      .filter((a) => targetAgentIds.includes(a.id))
      .map((a) => a.name)
      .join(', ');

    const transferPayload = {
      skillName: selectedSkill.name,
      skillSource: selectedSkill.source,
      fromAgentId: activeAgentId,
      toAgentIds: targetAgentIds,
      versioned,
      requestedBy: 'AgentFleet UI',
    };

    try {
      const result = await invokeRuntimeTool('pbk_transfer_agent_skill', transferPayload);
      assertBridgeTransferApplied(result, selectedSkill.name);
      // Record transfer in local skill history
      setAgents((prev) =>
        prev.map((agent) => {
          if (agent.id !== activeAgentId) return agent;
          return {
            ...agent,
            skills: agent.skills.map((s) => {
              if (s.name !== selectedSkill.name) return s;
              const history = s.transferHistory ?? [];
              return {
                ...s,
                transferHistory: [
                  ...history,
                  { toNames: targetNames.split(', '), at: new Date().toISOString(), versioned },
                ],
              };
            }),
          };
        })
      );
      showUiToast({
        tone: 'success',
        title: 'Skill transferred',
        desc: `'${selectedSkill.name}' copied to ${targetNames}${versioned ? ' (versioned)' : ''}`,
      });
      setTransferFeedbackByAgentId((current) => {
        const next = { ...current };
        for (const agentId of targetAgentIds) next[agentId] = 'Transferred';
        return next;
      });
      const timer = window.setTimeout(() => {
        setTransferFeedbackByAgentId((current) => {
          const next = { ...current };
          for (const agentId of targetAgentIds) delete next[agentId];
          return next;
        });
      }, 5000);
      transferFeedbackTimersRef.current.push(timer);
      setTransferStatus(`Bridge confirmed '${selectedSkill.name}' was applied to ${targetNames}.`);
    } catch (error) {
      // Queue for retry on next bridge reconnect
      pendingTransferQueueRef.current.push({
        ...transferPayload,
        queuedAt: new Date().toISOString(),
        retries: 0,
      });
      syncPendingTransferCount();
      const message =
        error instanceof Error ? error.message : 'Bridge did not confirm the skill transfer.';
      setTransferStatus(`${message} Queued retry for ${targetNames}.`);
      showUiToast({
        tone: 'error',
        title: 'Transfer queued',
        desc: `Bridge unavailable — '${selectedSkill.name}' queued for ${targetNames}. Will retry on reconnect.`,
      });
    }
    setSelectedSkill(null);
  };

  return (
    <div className="pbk-fleet-surface min-h-full text-slate-100">
      <main className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 px-4 py-5 pb-8">
        <AgentFleetHero
          agents={agents}
          bridgeConnected={bridgeConnected}
          pendingTransferCount={pendingTransferCount}
          leadCount={leadOptions.length}
          callCount={runtimeCalls.length}
        />
        {transferStatus && <div className="pbk-fleet-transfer-status">{transferStatus}</div>}

        {agentsLoading ? (
          <FleetLoadingSkeleton />
        ) : (
          <div className="pbk-fleet-layout">
            <section className="pbk-agent-grid" aria-label="Agent roster">
              {agents.map((agent) => {
                const bridgeWorker = getBridgeSnnWorkerForAgent(bridgeSnnWorkers, agent.id);
                const localSnnActive =
                  (agent.id === 'ava' && snnStatus.ava) || (agent.id === 'rex' && snnStatus.rex);
                return (
                  <AgentFleetCard
                    key={agent.id}
                    agent={agent}
                    selected={activeAgent.id === agent.id}
                    bridgeWorker={bridgeWorker}
                    healthProbe={getHealthProbeForAgent(agentHealthProbes, agent)}
                    localSnnActive={localSnnActive}
                    transferFeedback={transferFeedbackByAgentId[agent.id]}
                    lastOutcome={lastCallOutcomeByAgentId[agent.id] || 'No call outcome yet'}
                    onSelect={() => setActiveAgentId(agent.id)}
                  />
                );
              })}
              <div className="pbk-agent-deploy-card">
                <div className="plus">+</div>
                <h4>Deploy new agent</h4>
                <p>Remote deployment waits for canonical registry wiring.</p>
                <PbkDataSource endpoint="POST /api/agents/deploy" status="needs-wiring" />
              </div>
            </section>
            {/* Detail panel */}
            <AgentDetailPanel>
              <div className="pbk-dp-head">
                <div className="pbk-dp-head-row">
                  <div className="pbk-dp-avatar-wrap">
                    <div className="pbk-dp-avatar">{activeAgent.initial}</div>
                    <div className={`pbk-dp-status-dot ${activeActivityState}`} />
                  </div>
                  <div className="pbk-dp-id min-w-0">
                    <div className="name">
                      <em>{activeAgent.name}</em>
                    </div>
                    <div className="meta">
                      {activeAgent.role} - {activeAgent.version}
                    </div>
                  </div>
                  <div className="pbk-dp-flags">
                    <span>{activeAgent.status}</span>
                    {(activeLocalSnn || activeBridgeWorker?.ready) && <span>SNN ready</span>}
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                  {activeAgent.description}
                </p>
                <div className="pbk-dp-context-badges">
                  {activeAgent.metadata.approvalGated && <span>approval-gated</span>}
                  {activeAgent.metadata.suggestOnly && <span>suggest-only</span>}
                  <span>{activeAgent.metadata.orchestrationRole || 'worker'}</span>
                </div>
              </div>

              {/* Capabilities bar */}
              <div className="pbk-dp-context-badges border-b border-slate-800 px-4 py-3">
                {activeAgent.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="rounded-lg border border-slate-700/60 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-400"
                  >
                    {cap.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>

              <div className="border-b border-slate-800 px-4 py-4">
                <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                      Deal context preview
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Read-only preview of how {activeAgent.name} would handle a live lead. Provider
                      writes stay blocked.
                    </p>
                    <select
                      className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sky-500/60"
                      value={selectedLeadId}
                      onChange={(event) => setSelectedLeadId(event.target.value)}
                    >
                      {leadOptions.length ? (
                        leadOptions.map((lead) => (
                          <option key={getLeadOptionId(lead)} value={getLeadOptionId(lead)}>
                            {getLeadOptionLabel(lead)}
                          </option>
                        ))
                      ) : (
                        <option value="">No bridge leads loaded yet</option>
                      )}
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <button
                      type="button"
                      className="btn-secondary flex min-h-10 items-center justify-center gap-2"
                      disabled={!selectedLead || callActionPending}
                      onClick={handleCallSelectedLead}
                    >
                      {callActionPending ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Phone size={14} />
                      )}
                      {callActionPending ? 'Calling...' : 'Call lead'}
                    </button>
                    <button
                      type="button"
                      className="btn-primary flex min-h-10 items-center justify-center gap-2"
                      disabled={!selectedLead || previewLoading}
                      onClick={handlePreviewAgentDealContext}
                    >
                      {previewLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                      {previewLoading ? 'Previewing...' : `Preview ${activeAgent.name}`}
                    </button>
                  </div>
                </div>
                {previewError && (
                  <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-2">
                      <AlertCircle size={16} className="mt-0.5 shrink-0 text-rose-300" />
                      <div>
                        <div className="font-semibold">Preview failed</div>
                        <div className="mt-1 text-xs leading-relaxed text-rose-100/80">
                          {previewError}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-rose-300/40 px-3 py-1.5 text-xs font-semibold text-rose-50 transition hover:bg-rose-300/10"
                        onClick={() => void handlePreviewAgentDealContext()}
                      >
                        Retry preview
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-slate-500"
                        onClick={() => setPreviewError('')}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
                {dealPreview && (
                  <div className="mt-4 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.16em] text-sky-300">
                          {dealPreview.writeMode || 'read_only'} /{' '}
                          {dealPreview.result || 'agent_deal_context_preview'}
                        </div>
                        <h3 className="mt-1 text-sm font-semibold text-slate-100">
                          {formatAgentPreviewAction(dealPreview.recommendedAction)}
                        </h3>
                        <p className="mt-1 text-xs leading-relaxed text-slate-400">
                          {dealPreview.summary}
                        </p>
                      </div>
                      <span className="rounded-full border border-sky-500/30 px-3 py-1 text-[11px] font-semibold text-sky-200">
                        {Math.round(Number(dealPreview.confidence || 0))}% confidence
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                      <div className="rounded-xl bg-slate-950/70 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">
                          BANT
                        </div>
                        <div className="text-xs text-slate-300">
                          {dealPreview.bant?.complete
                            ? 'Complete'
                            : `Missing ${dealPreview.bant?.missing?.join(', ') || 'fields'}`}
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-950/70 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">
                          Analyzer
                        </div>
                        <div className="text-xs text-slate-300">
                          {dealPreview.analyzer?.found
                            ? `MAO ${dealPreview.analyzer.mao || '-'}`
                            : 'Numbers not found'}
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-950/70 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-slate-500">
                          Safety
                        </div>
                        <div className="text-xs text-slate-300">
                          {dealPreview.requiredApprovals?.length
                            ? `Approval: ${dealPreview.requiredApprovals.join(', ')}`
                            : 'No provider write'}
                        </div>
                      </div>
                    </div>
                    {dealPreview.reasoning?.length ? (
                      <ul className="mt-3 space-y-1 text-xs text-slate-500">
                        {dealPreview.reasoning.slice(0, 5).map((reason) => (
                          <li key={reason}>- {reason}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Skills */}
              <div className="p-4">
                {activeAgent.skills.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-500">
                    No skills recorded for {activeAgent.name} yet.
                  </div>
                ) : (
                  <>
                    <div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                      Production-ready and evolving skills
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {activeAgent.skills.map((skill) => {
                        const exKey = `${activeAgent.id}:${skill.name}`;
                        const isExampleOpen = expandedExample === exKey;
                        const isTestOpen = testingSkill === exKey;
                        return (
                          <div key={skill.name} className="pbk-skill-row fleet-skill-card">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <h3 className="flex items-center gap-2">
                                  {skill.name}
                                  {skill.transferHistory && skill.transferHistory.length > 0 && (
                                    <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">
                                      v{skill.transferHistory.length + 1}
                                    </span>
                                  )}
                                </h3>
                                <p>{skill.source}</p>
                              </div>
                              <span className="shrink-0 rounded-full border border-slate-700 px-2 py-1 text-[10px] text-slate-400">
                                {skill.confidence}%
                              </span>
                            </div>
                            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-red-400 via-amber-300 to-lime-300"
                                style={{ width: `${skill.confidence}%` }}
                              />
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                              <div className="rounded-xl bg-slate-900 px-3 py-2 text-slate-400">
                                Used{' '}
                                <span className="font-semibold text-slate-100">{skill.usage}</span>
                              </div>
                              <div className="rounded-xl bg-slate-900 px-3 py-2 text-slate-400">
                                Success{' '}
                                <span className="font-semibold text-lime-300">{skill.success}</span>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="chip-btn skill-transfer-btn"
                                onClick={() => setSelectedSkill(skill)}
                              >
                                Transfer
                              </button>
                              <button
                                type="button"
                                className="chip-btn"
                                onClick={() => setTestingSkill(isTestOpen ? null : exKey)}
                              >
                                Test on lead
                              </button>
                              <button
                                type="button"
                                className="chip-btn flex items-center gap-1"
                                onClick={() => setExpandedExample(isExampleOpen ? null : exKey)}
                              >
                                View example
                                {isExampleOpen ? (
                                  <ChevronUp size={11} />
                                ) : (
                                  <ChevronDown size={11} />
                                )}
                              </button>
                            </div>
                            {isTestOpen && (
                              <TestSkillPanel
                                skill={skill}
                                agentId={activeAgent.id}
                                onClose={() => setTestingSkill(null)}
                              />
                            )}
                            {isExampleOpen && !isTestOpen && (
                              <ExamplePanel skill={skill} agent={activeAgent} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </AgentDetailPanel>
          </div>
        )}
      </main>

      {selectedSkill && (
        <SkillTransferModal
          skill={selectedSkill}
          currentAgentId={activeAgent.id}
          agents={agents}
          onClose={() => setSelectedSkill(null)}
          onTransfer={handleTransfer}
        />
      )}
    </div>
  );
}
