import { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { showUiToast } from '../utils/uiFeedback';

type AgentSkill = {
  name: string;
  source: string;
  confidence: number;
  usage: string;
  success: string;
};

type FleetAgent = {
  id: string;
  name: string;
  role: string;
  status: string;
  initial: string;
  skills: AgentSkill[];
};

const AGENTS: FleetAgent[] = [
  {
    id: 'ava',
    name: 'Ava',
    role: 'Frontline closer',
    status: 'Live',
    initial: 'A',
    skills: [
      { name: 'Tactical Empathy', source: 'Voss - NSTD', confidence: 94, usage: '187x', success: '71%' },
      { name: 'Mirroring', source: 'Audiobook', confidence: 88, usage: '142x', success: '68%' },
      { name: 'Ackerman Negotiation v3', source: 'self-programmed', confidence: 71, usage: '23x', success: '52%' },
      { name: 'Silence Hold', source: '48 Laws - ch 28', confidence: 28, usage: '0x', success: '-' },
    ],
  },
  {
    id: 'rex',
    name: 'Rex',
    role: 'Strategist / orchestrator',
    status: 'Ready',
    initial: 'R',
    skills: [
      { name: 'Revenue Gap Scan', source: 'PBK runtime', confidence: 91, usage: '42x', success: '76%' },
    ],
  },
  {
    id: 'max',
    name: 'Max',
    role: 'Call analyzer',
    status: 'Learning',
    initial: 'M',
    skills: [
      { name: 'Pattern Tagging', source: 'call outcomes', confidence: 84, usage: '66x', success: '61%' },
    ],
  },
  {
    id: 'nova',
    name: 'Nova',
    role: 'Prosody tuner',
    status: 'Ready',
    initial: 'N',
    skills: [
      { name: 'Calm Downshift', source: 'voice trials', confidence: 79, usage: '51x', success: '58%' },
    ],
  },
];

interface SkillTransferModalProps {
  skill: { name: string; source: string; confidence: number };
  currentAgentId: string;
  agents: FleetAgent[];
  onClose: () => void;
  onTransfer: (targetAgentIds: string[], versioned: boolean) => void;
}

function SkillTransferModal({
  skill,
  currentAgentId,
  agents,
  onClose,
  onTransfer,
}: SkillTransferModalProps) {
  const targets = agents.filter((agent) => agent.id !== currentAgentId);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [versioned, setVersioned] = useState(true);

  const toggleTarget = (agentId: string) => {
    setSelectedIds((current) =>
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId],
    );
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal skill-transfer-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Transfer skill"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <div className="modal-kicker">Skill transfer</div>
            <h3>{skill.name}</h3>
            <p>{skill.source} - {skill.confidence}% confidence</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          {targets.map((agent) => {
            const checked = selectedIds.includes(agent.id);
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => toggleTarget(agent.id)}
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
            <span className="text-xs text-sky-200/75">Keep rollback path and outcome history separate.</span>
          </span>
          <input
            type="checkbox"
            checked={versioned}
            onChange={(event) => setVersioned(event.target.checked)}
            className="h-5 w-5 accent-sky-400"
          />
        </label>

        <div className="modal-footer">
          <span className="text-xs text-slate-500">
            {selectedIds.length} target agent{selectedIds.length === 1 ? '' : 's'} selected
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="btn-primary"
              disabled={!selectedIds.length}
              onClick={() => onTransfer(selectedIds, versioned)}
            >
              Transfer skill
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgentFleet() {
  const [activeAgentId, setActiveAgentId] = useState('ava');
  const [selectedSkill, setSelectedSkill] = useState<AgentSkill | null>(null);
  const activeAgent = useMemo(
    () => AGENTS.find((agent) => agent.id === activeAgentId) || AGENTS[0],
    [activeAgentId],
  );

  const handleTransfer = (targetAgentIds: string[], versioned: boolean) => {
    if (!selectedSkill) return;
    const targetNames = AGENTS
      .filter((agent) => targetAgentIds.includes(agent.id))
      .map((agent) => agent.name)
      .join(', ');
    showUiToast({
      tone: 'success',
      title: 'Skill transferred',
      desc: `✓ '${selectedSkill.name}' copied to ${targetNames}${versioned ? ' (versioned)' : ''}`,
    });
    setSelectedSkill(null);
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100 sm:text-2xl">Agent Fleet</h1>
          <p className="text-sm text-slate-400">Transfer proven skills across Ava, Rex, and specialist sub-agents.</p>
        </div>
        <div className="rounded-full border border-slate-800 bg-slate-950 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-500">
          UI prototype - no provider writes
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
        <section className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <div className="mb-2 px-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">Agents</div>
          <div className="space-y-2">
            {AGENTS.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => setActiveAgentId(agent.id)}
                className={[
                  'flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition',
                  activeAgent.id === agent.id
                    ? 'border-sky-500/40 bg-sky-500/10'
                    : 'border-slate-800 bg-slate-900/70 hover:border-slate-700',
                ].join(' ')}
              >
                <span className="agent-avatar">{agent.initial}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-100">{agent.name}</span>
                  <span className="block truncate text-xs text-slate-500">{agent.role}</span>
                </span>
                <span className="rounded-full border border-slate-700 px-2 py-1 text-[10px] uppercase text-slate-400">
                  {agent.status}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-950">
          <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-4 py-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Right-side detail panel</div>
              <h2 className="mt-1 text-2xl font-semibold text-slate-100">{activeAgent.name}</h2>
              <p className="text-sm text-slate-400">{activeAgent.role}</p>
            </div>
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
              Skills tab
            </span>
          </div>

          <div className="p-4">
            <div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-slate-500">
              Production-ready and evolving skills
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {activeAgent.skills.map((skill) => (
                <div key={skill.name} className="fleet-skill-card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3>{skill.name}</h3>
                      <p>{skill.source}</p>
                    </div>
                    <span className="rounded-full border border-slate-700 px-2 py-1 text-[10px] text-slate-400">
                      {skill.confidence}%
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full rounded-full bg-gradient-to-r from-red-400 via-amber-300 to-lime-300" style={{ width: `${skill.confidence}%` }} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl bg-slate-900 px-3 py-2 text-slate-400">
                      Used <span className="font-semibold text-slate-100">{skill.usage}</span>
                    </div>
                    <div className="rounded-xl bg-slate-900 px-3 py-2 text-slate-400">
                      Success <span className="font-semibold text-lime-300">{skill.success}</span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="chip-btn skill-transfer-btn" onClick={() => setSelectedSkill(skill)}>
                      Transfer
                    </button>
                    <button type="button" className="chip-btn">Test on lead</button>
                    <button type="button" className="chip-btn">View example</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {selectedSkill && (
        <SkillTransferModal
          skill={selectedSkill}
          currentAgentId={activeAgent.id}
          agents={AGENTS}
          onClose={() => setSelectedSkill(null)}
          onTransfer={handleTransfer}
        />
      )}
    </div>
  );
}
