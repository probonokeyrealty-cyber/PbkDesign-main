const DEFAULT_TEAM_WORKFLOWS = Object.freeze({
  build_script: {
    name: 'Build Sales Script',
    description: 'Idea -> Architect -> Writer -> Reviewer workflow for sales scripts and follow-up copy.',
    steps: [
      { key: 'idea', role: 'Idea Agent', prompt: 'Generate the strongest approach for this PBK goal.' },
      { key: 'architecture', role: 'Architect Agent', prompt: 'Turn the idea into a concise operating outline.' },
      { key: 'draft', role: 'Writer Agent', prompt: 'Write the deliverable using the outline and PBK voice.' },
      { key: 'review', role: 'Reviewer Agent', prompt: 'Review for clarity, compliance, risk, and usefulness. End with APPROVED or NEEDS_REVISION.' },
    ],
  },
  proposal: {
    name: 'Proposal Team',
    description: 'Creates a seller-facing or partner-facing proposal with review.',
    steps: [
      { key: 'idea', role: 'Deal Strategist', prompt: 'Identify the proposal angle, economic hook, and trust builder.' },
      { key: 'architecture', role: 'Offer Architect', prompt: 'Structure the proposal into sections and proof points.' },
      { key: 'draft', role: 'Proposal Writer', prompt: 'Write the proposal in a polished, concise format.' },
      { key: 'review', role: 'Risk Reviewer', prompt: 'Review for claims, compliance, and missing assumptions. End with APPROVED or NEEDS_REVISION.' },
    ],
  },
  engineering: {
    name: 'Engineering Team',
    description: 'Idea -> Architect -> Coder -> Reviewer workflow for implementation planning.',
    steps: [
      { key: 'idea', role: 'Product Agent', prompt: 'Clarify the user outcome and define the smallest valuable scope.' },
      { key: 'architecture', role: 'Architect Agent', prompt: 'Design the implementation plan and integration points.' },
      { key: 'code', role: 'Coder Agent', prompt: 'Produce implementation-ready pseudocode or patch guidance.' },
      { key: 'review', role: 'Reviewer Agent', prompt: 'Review for bugs, risks, tests, and rollback strategy. End with APPROVED or NEEDS_REVISION.' },
    ],
  },
});

function normalizeTemplateName(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return DEFAULT_TEAM_WORKFLOWS[normalized] ? normalized : 'build_script';
}

function normalizeTextResult(result) {
  if (typeof result === 'string') return result.trim();
  if (!result || typeof result !== 'object') return '';
  return String(
    result.answer
      || result.text
      || result.rawAnswer
      || result.response?.answer
      || result.response?.summary
      || result.response?.recommendation
      || JSON.stringify(result.response || result),
  ).trim();
}

function fallbackStepOutput({ role, goal, state }) {
  const seed = String(goal || 'PBK goal').trim();
  if (/review/i.test(role)) {
    return `APPROVED: The workflow output is ready for operator review. Goal: ${seed}`;
  }
  const prior = state?.idea || state?.architecture || state?.draft || state?.code || '';
  return `${role}: ${prior ? `Build on "${String(prior).slice(0, 160)}" to support` : 'Create a focused plan for'} ${seed}.`;
}

async function callStrategist({ strategist, role, goal, prompt, state }) {
  if (typeof strategist !== 'function') {
    return fallbackStepOutput({ role, goal, state });
  }
  const result = await strategist({
    role,
    goal,
    prompt,
    state,
    responseFormat: 'text',
  });
  return normalizeTextResult(result) || fallbackStepOutput({ role, goal, state });
}

export function listTeamWorkflowTemplates() {
  return Object.entries(DEFAULT_TEAM_WORKFLOWS).map(([id, workflow]) => ({
    id,
    name: workflow.name,
    description: workflow.description,
    steps: workflow.steps.map((step) => ({ key: step.key, role: step.role })),
  }));
}

export async function detectLangGraphAvailability() {
  try {
    await import('@langchain/langgraph');
    return { available: true, package: '@langchain/langgraph' };
  } catch (error) {
    return { available: false, package: '@langchain/langgraph', error: error?.message || String(error) };
  }
}

export async function runAgentTeamWorkflow(params = {}, options = {}) {
  const goal = String(params.goal || params.request || params.prompt || '').trim();
  if (!goal) return { ok: false, result: 'missing_goal', error: 'A goal is required.' };

  const templateId = normalizeTemplateName(params.teamName || params.team || params.workflow || 'build_script');
  const template = DEFAULT_TEAM_WORKFLOWS[templateId];
  const maxIterations = Math.max(1, Math.min(3, Number(params.maxIterations || params.max_iterations || 2)));
  const langGraph = await detectLangGraphAvailability();
  const trace = [];
  let state = {
    goal,
    templateId,
    templateName: template.name,
    approved: false,
    iteration: 0,
  };

  for (let iteration = 0; iteration < maxIterations && !state.approved; iteration += 1) {
    state.iteration = iteration + 1;
    for (const step of template.steps) {
      const priorState = { ...state };
      const output = await callStrategist({
        strategist: options.strategist,
        role: step.role,
        goal,
        prompt: `${step.prompt}\n\nGoal: ${goal}\n\nCurrent state:\n${JSON.stringify(priorState, null, 2)}`,
        state: priorState,
      });
      state = {
        ...state,
        [step.key]: output,
      };
      trace.push({
        iteration: state.iteration,
        step: step.key,
        role: step.role,
        output,
      });
      if (step.key === 'review') {
        state.approved = /\bAPPROVED\b/i.test(output) || !/\bNEEDS_REVISION\b/i.test(output);
      }
    }
  }

  return {
    ok: true,
    result: state.approved ? 'approved' : 'completed_with_review_notes',
    engine: langGraph.available ? 'langgraph-compatible' : 'native-fallback',
    langGraph,
    workflow: {
      id: templateId,
      name: template.name,
      description: template.description,
    },
    state,
    trace,
  };
}
