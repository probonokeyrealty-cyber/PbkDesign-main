export type RegistryAgent = {
  id: string;
  name: string;
  initial: string;
  role: string;
  description: string;
  capabilities: string[];
  status: 'active' | 'standby' | 'inactive';
  version: string;
  metadata: {
    orchestrationRole?: 'supervisor' | 'worker';
    supervises?: string[];
    supervisor?: string;
    approvalGated?: boolean;
    suggestOnly?: boolean;
  };
};

function ini(name: string): string {
  return String(name || '?')[0].toUpperCase();
}

export const AGENT_REGISTRY: RegistryAgent[] = [
  {
    id: 'ava',
    name: 'Ava',
    initial: ini('Ava'),
    role: 'Frontline closer / supervisor',
    description: 'Primary PBK acquisition closer and voice supervisor.',
    capabilities: ['voice', 'negotiation', 'closing', 'bant', 'path_locking', 'rag', 'memory_retrieval', 'turn_coordination'],
    status: 'active',
    version: 'v2.1',
    metadata: { orchestrationRole: 'supervisor', supervises: ['max', 'rex', 'hermes'] },
  },
  {
    id: 'rex',
    name: 'Rex',
    initial: ini('Rex'),
    role: 'Strategist / orchestrator',
    description: 'PBK strategist, research, autonomous goals, proactive triggers, revenue alignment, and memory agent.',
    capabilities: ['strategy', 'research', 'revenue_alignment', 'autonomous_goal_setting', 'proactive_triggers', 'market_intel', 'memory_synthesis'],
    status: 'active',
    version: 'v3.0',
    metadata: { orchestrationRole: 'worker', supervisor: 'ava' },
  },
  {
    id: 'max',
    name: 'Max',
    initial: ini('Max'),
    role: 'Closer / contract handoff',
    description: 'PBK closer and contract handoff agent for offer recap, seller follow-up, and approval-gated contract delivery.',
    capabilities: ['closing', 'contract_handoff', 'offer_recap', 'seller_follow_up', 'sms', 'calling', 'skill_execution'],
    status: 'active',
    version: 'v1.4',
    metadata: { orchestrationRole: 'worker', supervisor: 'ava', approvalGated: true },
  },
  {
    id: 'hermes',
    name: 'Hermes',
    initial: ini('Hermes'),
    role: 'Analyst (suggest-only)',
    description: 'Suggest-only analyst lane for transcript, feedback, and pattern diagnosis.',
    capabilities: ['analysis', 'suggestions', 'feedback_review', 'risk_review', 'pattern_detection'],
    status: 'active',
    version: 'v1.0',
    metadata: { orchestrationRole: 'worker', supervisor: 'ava', suggestOnly: true },
  },
  {
    id: 'call-analyzer',
    name: 'Call Analyzer',
    initial: 'C',
    role: 'Call analyzer',
    description: 'Reviews Ava call transcripts, scores quality, tags failures, and proposes improvements.',
    capabilities: ['analysis', 'post_call', 'quality_scoring', 'failure_tags', 'coaching'],
    status: 'active',
    version: 'v1.0',
    metadata: { orchestrationRole: 'worker', supervisor: 'rex' },
  },
  {
    id: 'prosody-tuner',
    name: 'Prosody Tuner',
    initial: 'P',
    role: 'Voice / prosody tuner',
    description: 'Builds and evaluates Ava voice stability, speed, emotion, and prosody choices.',
    capabilities: ['voice_tuning', 'prosody', 'emotion', 'ml', 'tts_quality'],
    status: 'active',
    version: 'v1.0',
    metadata: { orchestrationRole: 'worker', supervisor: 'rex' },
  },
  {
    id: 'script-rotator',
    name: 'Script Rotator',
    initial: 'S',
    role: 'Script A/B manager',
    description: 'Selects and rotates scripts, trust builders, and objection lines using sentiment and outcomes.',
    capabilities: ['script_management', 'context_aware_rotation', 'ab_testing', 'objection_handling', 'trust_builders', 'anti_repeat'],
    status: 'active',
    version: 'v1.0',
    metadata: { orchestrationRole: 'worker', supervisor: 'ava' },
  },
  {
    id: 'bant-enforcer',
    name: 'BANT Enforcer',
    initial: 'B',
    role: 'Call qualifier',
    description: 'Tracks budget, authority, need, timeline, urgency, and call qualification completeness.',
    capabilities: ['qualification', 'bant', 'goal_inference', 'clarifying_questions', 'path_locking'],
    status: 'active',
    version: 'v1.0',
    metadata: { orchestrationRole: 'worker', supervisor: 'ava' },
  },
  {
    id: 'qa-agent',
    name: 'QA Agent',
    initial: 'Q',
    role: 'QA / audit',
    description: 'Validates tool outputs, audits provider proof, and escalates silent failures.',
    capabilities: ['qa', 'tool_validation', 'audit', 'approval_escalation', 'reliability'],
    status: 'active',
    version: 'v1.0',
    metadata: { orchestrationRole: 'worker', supervisor: 'rex' },
  },
  {
    id: 'nurture-agent',
    name: 'Nurture Agent',
    initial: 'N',
    role: 'Lead nurture',
    description: 'Recommends and manages approval-gated SMS, email, and call follow-up sequences.',
    capabilities: ['nurture', 'campaigns', 'follow_up', 'sms', 'email', 'calling', 'scheduling'],
    status: 'active',
    version: 'v1.0',
    metadata: { orchestrationRole: 'worker', supervisor: 'ava', approvalGated: true },
  },
  {
    id: 'research-orchestrator',
    name: 'Research Orchestrator',
    initial: 'R',
    role: 'Research / planning',
    description: 'Coordinates PBK research additives: ACP-style interop, path search, workflow induction, and compact memory.',
    capabilities: ['research_additives', 'agent_interop', 'execution_path_search', 'workflow_induction', 'tool_discovery', 'compact_memory'],
    status: 'active',
    version: 'v1.0',
    metadata: { orchestrationRole: 'worker', supervisor: 'rex', approvalGated: true },
  },
];

export function getAgentById(id: string): RegistryAgent | undefined {
  return AGENT_REGISTRY.find((a) => a.id === id);
}

export function getAgentsByCapability(capability: string): RegistryAgent[] {
  const cap = capability.toLowerCase();
  return AGENT_REGISTRY.filter(
    (a) => a.status === 'active' && a.capabilities.map((c) => c.toLowerCase()).includes(cap),
  );
}
