import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bridgeInvoke, bridgeRequest, formatBridgeError } from '../client.js';

const GetBrainStateInput = z
  .object({
    query: z.string().optional().describe('Optional natural-language query. Bridge tries to ground its answer in current brainDocs.'),
    webSearch: z.boolean().optional().describe('Force OpenAI Responses web search for current/live information when configured.'),
    useOpenAiSearch: z.boolean().optional().describe('Alias for webSearch.'),
    limit: z.number().int().min(1).max(20).optional().describe('Used for readable summaries.'),
  })
  .strict();

const GetReadableSummaryInput = z
  .object({
    limit: z.number().int().min(1).max(20).optional().describe('How many approvals/feedback/intents/activity rows to summarize.'),
  })
  .strict();

const OpenAiWebSearchInput = z
  .object({
    query: z.string().min(1).describe('Current-information question Rex should answer with OpenAI Responses web search.'),
    model: z.string().optional().describe('Optional OpenAI model override. Defaults to the bridge runtime setting.'),
  })
  .strict();

const GetBrainEmailContextInput = z
  .object({
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
    email: z.string().optional(),
    templateId: z.string().optional().describe('Optional cold-email template hint such as probate, absentee, or high-equity.'),
    requestedBy: z.string().optional(),
  })
  .strict();

const IngestResearchDocInput = z
  .object({
    title: z.string().min(1).describe('Document title (shows on the Brain page).'),
    source: z.string().optional().describe('Where it came from (URL, paper title, internal team name).'),
    sourceUrl: z.string().optional().describe('Optional URL to fetch/index when the source is a web page, PDF, video, or audio URL.'),
    url: z.string().optional().describe('Alias for sourceUrl.'),
    summary: z.string().optional(),
    excerpt: z.string().optional(),
    citation: z.string().optional(),
    kind: z.enum(['note', 'article', 'paper', 'transcript', 'playbook', 'audio', 'video', 'attachment']).optional(),
    topic: z.string().optional().describe("E.g., 'Tampa probate', 'wholesaling laws', 'Telnyx setup'."),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const GetStateInput = z
  .object({
    section: z.enum(['all', 'approvals', 'activity', 'brainDocs', 'leadImports', 'analyzerRuns', 'calls', 'messages', 'appointments', 'leadStageTransitions', 'contracts', 'dncEntries', 'pbkMemories', 'pbkFeedback', 'pbkIntentEvents', 'pbkKnowledge', 'avaLearningRequests', 'repairItems', 'offerOverrides', 'scriptTests', 'scriptTestEvents', 'avaOutcomeReports', 'avaImprovementSuggestions', 'knowledgeVerifications', 'status']).default('all').describe('Which slice of the bridge state to return. Use a section to keep response small.'),
    limit: z.number().int().min(1).max(80).default(20).describe('Max items per array section.'),
  })
  .strict();

const ListAgentsInput = z
  .object({
    capability: z.string().optional().describe("Filter to agents that have this capability (e.g. 'negotiation', 'closing')."),
    includeInactive: z.boolean().optional().describe('Include standby/inactive agents. Defaults false.'),
  })
  .strict();

const TransferAgentSkillInput = z
  .object({
    skillName: z.string().min(1).describe('Name of the skill to transfer.'),
    skillSource: z.string().optional().describe('Source reference for the skill (book, training set, etc.).'),
    fromAgentId: z.string().min(1).describe('ID of the agent donating the skill.'),
    toAgentIds: z.array(z.string().min(1)).min(1).describe('IDs of the agents receiving the skill.'),
    versioned: z.boolean().optional().describe('If true, creates a versioned copy with rollback path. Recommended.'),
    confidence: z.number().min(0).max(1).optional().describe('Initial confidence score for transferred skill.'),
    requestedBy: z.string().optional().describe('Actor label for bridge activity.'),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const LaunchBrowserResearchInput = z
  .object({
    query: z.string().min(1).describe('Natural-language browser research request, URL, or listing/property prompt for BrowserOS.'),
    requestedBy: z.string().optional().describe('Actor label recorded in the bridge activity feed.'),
    source: z.string().optional().describe("Origin label such as 'brain', 'shell-brain', or 'agent-console'."),
  })
  .strict();

const AddPbkMemoryInput = z
  .object({
    tenantId: z.string().optional(),
    leadId: z.string().optional(),
    agentName: z.string().optional(),
    memoryType: z.string().optional().describe('episodic, semantic, objection, seller-preference, etc.'),
    content: z.string().min(1).describe('The memory text Ava/Rex should be able to recall later.'),
    importance: z.number().min(0).max(1).optional(),
    source: z.string().optional(),
    sourceId: z.string().optional(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const RecallPbkMemoryInput = z
  .object({
    tenantId: z.string().optional(),
    leadId: z.string().optional(),
    query: z.string().optional().describe('What Ava/Rex is trying to remember.'),
    memoryType: z.string().optional(),
    limit: z.number().int().min(1).max(20).optional(),
    includeGlobal: z.boolean().optional(),
  })
  .strict();

const RememberPersonalFactInput = z
  .object({
    tenantId: z.string().optional(),
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    factType: z.string().min(1).describe('child_name, child_age, spouse_name, pet_name, hobby, callback_preference, or personal_note.'),
    factValue: z.string().min(1).describe('The seller-shared detail to remember.'),
    conversationCue: z.string().optional().describe('The phrase or context that caused Ava to store the fact.'),
    returnToBusinessCue: z.string().optional().describe('Natural transition Ava should use after brief rapport.'),
    nextBestQuestion: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const GetPersonalContextInput = z
  .object({
    tenantId: z.string().optional(),
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    subject: z.string().optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

const RecordPbkFeedbackInput = z
  .object({
    tenantId: z.string().optional(),
    leadId: z.string().optional(),
    callId: z.string().optional(),
    agentName: z.string().optional(),
    agentAction: z.string().optional(),
    humanDecision: z.string().optional().describe('approved, rejected, needs_revision, false_positive, etc.'),
    transcriptSnippet: z.string().optional(),
    outcomeLabel: z.string().optional(),
    approvalId: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const PbkLearnFromChatInput = z
  .object({
    tenantId: z.string().optional(),
    leadId: z.string().optional(),
    callId: z.string().optional(),
    approvalId: z.string().optional(),
    agentName: z.string().optional(),
    actor: z.string().optional(),
    topic: z.string().optional().describe('Subject Ava should attach this learning to.'),
    fact: z.string().optional().describe('Specific fact, policy, preference, or lesson being taught.'),
    lesson: z.string().optional().describe('Human-readable lesson Ava should remember.'),
    conversation: z.string().optional().describe('Conversation excerpt that produced the learning.'),
    message: z.string().optional(),
    transcript: z.string().optional(),
    subject: z.string().optional(),
    predicate: z.string().optional(),
    object: z.string().optional(),
    scope: z.string().optional().describe('routine, lead, deal, preference, strategic, policy, pricing, compliance, etc.'),
    strategic: z.boolean().optional().describe('Set true only for permanent PBK doctrine, pricing rules, policies, scripts, or core behavior changes.'),
    passcode: z.string().optional().describe('Protected admin passcode for strategic/core brain updates only. Do not use for routine lead/deal learning.'),
    confidence: z.number().min(0).max(1).optional(),
    confidenceThreshold: z.number().min(0).max(1).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const DetectPbkIntentInput = z
  .object({
    tenantId: z.string().optional(),
    leadId: z.string().optional(),
    callId: z.string().optional(),
    text: z.string().optional(),
    transcript: z.string().optional(),
    persist: z.boolean().optional().describe('Defaults true. Set false for read-only classification.'),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const RecordPbkKnowledgeInput = z
  .object({
    tenantId: z.string().optional(),
    subject: z.string().min(1),
    predicate: z.string().min(1),
    object: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    source: z.string().optional(),
    sourceId: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const QueryPbkKnowledgeInput = z
  .object({
    tenantId: z.string().optional(),
    subject: z.string().optional(),
    predicate: z.string().optional(),
    query: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const RunPbkAgentPipelineInput = z
  .object({
    tenantId: z.string().optional(),
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
    transcript: z.string().optional(),
    text: z.string().optional(),
    bant: z.record(z.unknown()).optional(),
    leadContext: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const AvaAskStrategistInput = z
  .object({
    tenantId: z.string().optional(),
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
    situation: z.string().min(1).describe('What Ava is uncertain about right now.'),
    transcript: z.string().optional().describe('Relevant live-call transcript excerpt.'),
    confidence: z.number().min(0).max(1).optional().describe("Ava's current confidence before coaching."),
    attemptedActions: z.array(z.string()).optional().describe('What Ava already tried.'),
    arv: z.number().nonnegative().optional(),
    mao: z.number().nonnegative().optional(),
    currentOffer: z.number().nonnegative().optional(),
    sellerAsk: z.number().nonnegative().optional(),
    sellerMotivation: z.string().optional(),
    storeRule: z.boolean().optional().describe('Defaults true. Stores the learned strategist rule into PBK knowledge.'),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const TeachAvaInput = z
  .object({
    learningId: z.string().optional().describe('Ava learning request id returned by pbk_ava_ask_strategist.'),
    objectionType: z.string().optional().describe('e.g. competing_offer, price_pushback, probate, trust_scam.'),
    script: z.string().optional().describe('Exact seller-facing wording Ava should remember.'),
    rule: z.string().optional().describe('Durable rule Ava should apply next time.'),
    strategic: z.boolean().optional().describe('Defaults true. Strategic changes require protected passcode.'),
    passcode: z.string().optional().describe('Protected admin passcode for core strategy updates.'),
    confidenceBoost: z.number().min(0).max(1).optional(),
    actor: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const RepairItemInput = z
  .object({
    itemName: z.string().optional(),
    item_name: z.string().optional(),
    name: z.string().optional(),
    itemCategory: z.string().optional(),
    item_category: z.string().optional(),
    category: z.string().optional(),
    estimatedCost: z.number().nonnegative().optional(),
    estimated_cost: z.number().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
    urgency: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    isRequired: z.boolean().optional(),
    is_required: z.boolean().optional(),
    notes: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

const RecordRepairsInput = z
  .object({
    tenantId: z.string().optional(),
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
    repairs: z.array(RepairItemInput).min(1),
    replace: z.boolean().optional().describe('Defaults true for this lead.'),
    actor: z.string().optional(),
  })
  .strict();

const SendNegotiationApprovalInput = z
  .object({
    tenantId: z.string().optional(),
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
    arv: z.number().nonnegative().optional(),
    mao: z.number().nonnegative().optional(),
    repairs: z.number().nonnegative().optional(),
    repairsDetail: z.array(RepairItemInput).optional(),
    currentOffer: z.number().nonnegative().optional(),
    sellerAsk: z.number().nonnegative().optional(),
    sellerMotivation: z.string().optional(),
    recommendedCounter: z.number().nonnegative().optional(),
    rationale: z.string().optional(),
    actor: z.string().optional(),
  })
  .strict();

const AvaOverrideOfferInput = z
  .object({
    tenantId: z.string().optional(),
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
    finalOffer: z.number().positive(),
    mao: z.number().nonnegative().optional(),
    approvalId: z.string().optional().describe('Approved negotiation approval id. Required unless protected passcode is supplied.'),
    rationale: z.string().optional(),
    avaScript: z.string().optional(),
    passcode: z.string().optional().describe('Protected admin passcode for direct override.'),
    actor: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const ScriptVariantInput = z
  .object({
    id: z.string().optional(),
    variantId: z.string().optional(),
    label: z.string().optional(),
    name: z.string().optional(),
    script: z.string().min(1),
    hypothesis: z.string().optional(),
    weight: z.number().positive().optional(),
  })
  .passthrough();

const ScriptTestInput = z
  .object({
    action: z.enum(['create', 'start', 'assign', 'choose', 'exposure', 'record_outcome', 'outcome', 'complete', 'report', 'list']).optional(),
    tenantId: z.string().optional(),
    testId: z.string().optional(),
    id: z.string().optional(),
    objectionType: z.string().optional(),
    topic: z.string().optional(),
    name: z.string().optional(),
    scriptA: z.string().optional(),
    scriptB: z.string().optional(),
    variants: z.array(ScriptVariantInput).optional(),
    successMetric: z.string().optional(),
    sampleSizeTarget: z.number().int().min(10).max(500).optional(),
    leadId: z.string().optional(),
    callId: z.string().optional(),
    sessionId: z.string().optional(),
    variantId: z.string().optional(),
    outcomeLabel: z.string().optional(),
    outcome: z.string().optional(),
    success: z.boolean().optional(),
    dealValue: z.number().nonnegative().optional(),
    closeTest: z.boolean().optional(),
    actor: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const TestSkillInput = z
  .object({
    tenantId: z.string().optional(),
    skillName: z.string().min(1),
    skillSource: z.string().optional(),
    agentId: z.string().optional(),
    agentName: z.string().optional(),
    scenario: z.string().min(1),
    prompt: z.string().optional(),
    transcript: z.string().optional(),
    text: z.string().optional(),
    objectionType: z.string().optional(),
    requestedBy: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const UpdateCrmInput = z
  .object({
    leadId: z.string().optional(),
    target: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    stage: z.string().optional(),
    status: z.string().optional(),
    message: z.string().optional(),
    notes: z.string().optional(),
    lead: z.record(z.unknown()).optional(),
    transition: z.record(z.unknown()).optional(),
    deal: z.record(z.unknown()).optional(),
    agentDealContext: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

const GetSnnWorkerStatusInput = z
  .object({
    agentId: z.string().optional().describe('Optional agent id to inspect, such as ava or rex.'),
    agentName: z.string().optional().describe('Optional agent name to inspect.'),
    agents: z.array(z.string()).optional().describe('Optional list of agent ids/names to inspect.'),
  })
  .strict();

const PreviewAgentDealContextInput = z
  .object({
    agentId: z.string().optional().describe('Agent id to preview, such as ava, rex, max, hermes, or bant-enforcer.'),
    agentName: z.string().optional().describe('Agent name to preview.'),
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    selectedPath: z.string().optional().describe('Optional PBK path hint, such as cash, rbp, cf, mt, or land.'),
    bant: z.record(z.unknown()).optional().describe('Optional BANT facts to use for preview only.'),
  })
  .passthrough();

const OutcomeAnalyzerInput = z
  .object({
    tenantId: z.string().optional(),
    days: z.number().int().min(1).max(365).optional(),
    periodDays: z.number().int().min(1).max(365).optional(),
    persist: z.boolean().optional(),
    actor: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const SuggestionEngineInput = z
  .object({
    tenantId: z.string().optional(),
    days: z.number().int().min(1).max(365).optional(),
    periodDays: z.number().int().min(1).max(365).optional(),
    persist: z.boolean().optional(),
    objectionType: z.string().optional(),
    challengerScript: z.string().optional(),
    successMetric: z.string().optional(),
    rollbackCondition: z.string().optional(),
    actor: z.string().optional(),
    analysis: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const KnowledgeVerifierInput = z
  .object({
    tenantId: z.string().optional(),
    subject: z.string().optional(),
    predicate: z.string().optional(),
    object: z.string().optional(),
    topic: z.string().optional(),
    objectionType: z.string().optional(),
    kind: z.string().optional(),
    rule: z.string().optional(),
    fact: z.string().optional(),
    lesson: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    apply: z.boolean().optional().describe('If true, insert the verified fact into PBK knowledge when approved.'),
    persistFact: z.boolean().optional(),
    strategic: z.boolean().optional().describe('Defaults true. Strategic facts require protected passcode to apply.'),
    passcode: z.string().optional(),
    source: z.string().optional(),
    sourceId: z.string().optional(),
    actor: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export function registerBrainTools(server: McpServer): void {
  server.registerTool(
    'pbk_get_brain_email_context',
    {
      title: 'Build Brain email context',
      description: `Assemble the seller/property context used for cold-email personalization from the current bridge state and analyzer history.

Args:
  - leadId, leadName, address, email (optional): Lead identifiers.
  - templateId (string): Optional template hint such as "probate" or "absentee".
  - requestedBy (string): Actor label for bridge activity.

Returns:
  { ok: true, context: { ownerName, propertyAddress, estimatedEquity, marketValue, targetOffer, mao, recentComps, motivationSignals, ... } }`,
      inputSchema: GetBrainEmailContextInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('getBrainEmailContext', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_get_brain_state',
    {
      title: 'Query the OpenClaw Brain',
      description: `Ask the bridge's grounded-answer engine. With a query, returns a natural-language response plus citations into brainDocs. Without a query, returns the current Brain summary, top docs, and status.

Args:
  - query (string, optional): "How are we handling probate disclosures?" or "What's the latest on telnyx voicemail drop?"

Returns:
  { answer?: string, citations?: Array<{id, title, source}>, brainDocs: Array<{...}>, status: {...} }`,
      inputSchema: GetBrainStateInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('getBrainState', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_get_readable_summary',
    {
      title: 'Readable PBK operator summary',
      description: `Convert raw PBK approvals, feedback, intent events, and activity into a plain-English operator summary. Use this when a human asks for readable logs, pending approvals, or daily status.`,
      inputSchema: GetReadableSummaryInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('getReadableSummary', params);
        return {
          content: [
            {
              type: 'text',
              text: String((result as Record<string, unknown>)?.summary || JSON.stringify(result, null, 2)),
            },
          ],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_openai_web_search',
    {
      title: 'OpenAI web search for Rex',
      description: `Use the bridge's OpenAI API key with the Responses API web_search tool to answer current-market or recent-information questions. This is live search; it is not the model's static training memory.`,
      inputSchema: OpenAiWebSearchInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('openAiWebSearch', params);
        return {
          content: [
            {
              type: 'text',
              text: String((result as Record<string, unknown>)?.answer || JSON.stringify(result, null, 2)),
            },
          ],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_add_memory',
    {
      title: 'Store PBK memory',
      description: `Store a durable Ava/Rex memory for a tenant/lead. Use this for seller preferences, successful rebuttals, call lessons, and deal context that should survive future sessions.`,
      inputSchema: AddPbkMemoryInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('addPbkMemory', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_recall_memory',
    {
      title: 'Recall PBK memory',
      description: `Recall durable PBK memories for a lead or globally. This is the safe native retrieval layer that can later be upgraded with pgvector/Mem0 without changing the agent contract.`,
      inputSchema: RecallPbkMemoryInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('recallPbkMemory', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_remember_personal_fact',
    {
      title: 'Remember seller personal context',
      description: `Store structured personal context Ava can use for rapport continuity, such as newborn name/age, spouse, pets, hobbies, callback preferences, or meaningful life events. Use one warm follow-up later, then return to business.`,
      inputSchema: RememberPersonalFactInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('rememberPersonalFact', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_get_personal_context',
    {
      title: 'Get seller personal context',
      description: `Recall structured personal context for a lead before a call. Use sparingly: one relevant warm question, then return to the seller's business goal.`,
      inputSchema: GetPersonalContextInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('getPersonalContext', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_ava_ask_strategist',
    {
      title: 'Ask PBK strategist for Ava coaching',
      description: `When Ava is uncertain on a live seller call, ask the DeepSeek strategist lane for veteran acquisition guidance. The bridge stores the coaching request, adds the durable rule to PBK knowledge, and falls back to the local PBK playbook if DeepSeek is unavailable. This does not send calls, contracts, SMS, or offer changes.`,
      inputSchema: AvaAskStrategistInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('avaAskStrategist', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_teach_ava',
    {
      title: 'Teach Ava a durable strategy',
      description: `Convert an operator/strategist correction into Ava memory and PBK knowledge. Strategic/core behavior updates are approval-gated unless the protected admin passcode is supplied.`,
      inputSchema: TeachAvaInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('pbk_teach_ava', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_record_repairs',
    {
      title: 'Record line-item repairs',
      description: `Store property repair line items for a lead so Ava can explain the offer like a seasoned acquisitions operator. The repair summary is also written to PBK memory for future calls.`,
      inputSchema: RecordRepairsInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('recordRepairs', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_send_negotiation_approval',
    {
      title: 'Send negotiation approval',
      description: `Create a rich approval request for an offer/counteroffer, including MAO, repair breakdown, seller ask, recommendation, and Ava's final delivery script. Ava cannot deliver the final number until approved.`,
      inputSchema: SendNegotiationApprovalInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('sendNegotiationApproval', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_ava_override_offer',
    {
      title: 'Record approved offer override',
      description: `Record an approved final offer and return Ava's exact delivery script. Requires an approved negotiation approval id or the protected admin passcode; otherwise the bridge queues approval instead of changing the offer.`,
      inputSchema: AvaOverrideOfferInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('avaOverrideOffer', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_script_test',
    {
      title: 'Run Ava script A/B test',
      description: `Create, assign, record outcomes for, or report on Ava negotiation script tests. This is the measurable quality gate that keeps winning seller language and rolls back weak scripts.`,
      inputSchema: ScriptTestInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('pbk_script_test', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_test_skill',
    {
      title: 'Test an Agent Fleet skill',
      description: 'Evaluate a proposed or transferred skill against a scenario without promoting it. Returns the existing script-test evidence gate so operators can keep skill changes measurable.',
      inputSchema: TestSkillInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('pbk_test_skill', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_update_crm',
    {
      title: 'Update PBK CRM record',
      description: 'Route a lead/deal CRM update through the bridge updateCRM handler so CRM writes stay approval-aware and visible in PBK activity.',
      inputSchema: UpdateCrmInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('updateCRM', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_get_snn_worker_status',
    {
      title: 'Get SNN worker status',
      description: 'Read the production SNN/cognitive worker lanes for Ava, Rex, and related agents. The bridge reports tool/spike readiness and does not claim visibility into browser-scoped Web Workers.',
      inputSchema: GetSnnWorkerStatusInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('getSnnWorkerStatus', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_preview_agent_deal_context',
    {
      title: 'Preview agent deal context',
      description: 'Preview how a PBK agent would handle a lead/deal using current lead, BANT, analyzer, registry, and safety context. This is read-only and never calls, texts, emails, updates CRM, or sends contracts.',
      inputSchema: PreviewAgentDealContextInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('previewAgentDealContext', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_outcome_analyzer',
    {
      title: 'Analyze Ava outcomes',
      description: `Review recent approvals, feedback, intent events, coaching requests, and script test outcomes. Returns measurable patterns and recommendations for sharpening Ava.`,
      inputSchema: OutcomeAnalyzerInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('pbk_outcome_analyzer', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_suggestion_engine',
    {
      title: 'Generate Ava improvement suggestions',
      description: `Turn outcome analysis into testable, rollback-safe Ava improvements. Suggestions include evidence, metric, rollback condition, and the next tool/action to run.`,
      inputSchema: SuggestionEngineInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('pbk_suggestion_engine', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_knowledge_verifier',
    {
      title: 'Verify PBK knowledge before learning',
      description: `Validate proposed Ava/Rex knowledge against PBK safety, MAO, approval, DNC/TCPA, and truthful-AI boundaries. Can optionally apply safe facts to PBK knowledge with protected approval.`,
      inputSchema: KnowledgeVerifierInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('pbk_knowledge_verifier', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_record_feedback',
    {
      title: 'Record PBK feedback',
      description: `Capture human approval/rejection feedback for Ava/Rex actions. This is the training-data spine for future self-improvement and fine-tuning exports.`,
      inputSchema: RecordPbkFeedbackInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('recordPbkFeedback', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_learn',
    {
      title: 'PBK learning capture',
      description: `Capture Ava/Rex learning signals from conversations, approvals, calls, and operator corrections. Routine lead/deal learning is frictionless; strategic/core updates require the protected admin passcode before becoming applied PBK knowledge.`,
      inputSchema: PbkLearnFromChatInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('pbk_learn', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_learn_from_chat',
    {
      title: 'Teach Ava/Rex from conversation (alias for pbk_learn)',
      description: `Alias for pbk_learn. Capture conversational learning for Ava/Rex. Routine lead, call, objection, seller-preference, and deal lessons do not require a passcode. Strategic/core PBK doctrine, pricing rules, policy, script, contract-default, identity, or compliance updates are stored as pending unless the protected admin passcode is supplied.`,
      inputSchema: PbkLearnFromChatInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('pbk_learn', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_detect_intent',
    {
      title: 'Detect wholesale intent',
      description: `Classify a transcript snippet into launch-safe wholesale intents such as ready_to_close, callback_request, objection_price, financing_question, trust_scam, or not_interested.`,
      inputSchema: DetectPbkIntentInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('detectPbkIntent', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_record_knowledge',
    {
      title: 'Record PBK knowledge fact',
      description: `Write a lightweight knowledge graph fact such as property_123 has_zoning residential or zip_43215 avg_offer_ratio 0.68.`,
      inputSchema: RecordPbkKnowledgeInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('recordPbkKnowledge', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_query_knowledge',
    {
      title: 'Query PBK knowledge graph',
      description: `Read lightweight knowledge graph facts for a property, zip, lead, market, or predicate. Useful for answering property context questions from Ava/Rex.`,
      inputSchema: QueryPbkKnowledgeInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('queryPbkKnowledge', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_run_agent_pipeline',
    {
      title: 'Run PBK agent pipeline',
      description: `Run the safe advisory multi-agent state machine: Lead Qualifier -> Negotiator -> Contract Prep / Follow-up / Verification. It never sends providers directly; PBK approval gates still apply.`,
      inputSchema: RunPbkAgentPipelineInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('runPbkAgentPipeline', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_ingest_research_doc',
    {
      title: 'Add a doc to the Brain',
      description: `Index a new research source into the bridge's brainDocs[]. Used to add policy notes, scripts, market memos — any context you want OpenClaw to reach for during deals.

Args:
  - title (string, required): Display title.
  - source (string): URL, paper title, or origin label.
  - summary, excerpt, citation (strings): Optional. If only one is given, it's used for both excerpt and summary.
  - kind ('note'|'article'|'paper'|'transcript'|'playbook'): Defaults to 'note'.
  - topic (string): Logical bucket. Defaults to 'Wholesaling'.
  - tags (string[]): Free-form tags.

Returns:
  { ok: true, doc: {id, kind, topic, title, source, excerpt, summary, citation, createdAt, tags} }`,
      inputSchema: IngestResearchDocInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('ingestResearchDoc', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_get_state',
    {
      title: 'Read bridge state',
      description: `Snapshot of the bridge's full state, or a slice of it. Backs the dashboard's polling loop, but exposed here so other agents can inspect approvals, activity, contracts, calls, etc. directly.

Args:
- section ('all' | 'approvals' | 'activity' | 'brainDocs' | 'leadImports' | 'analyzerRuns' | 'calls' | 'messages' | 'appointments' | 'leadStageTransitions' | 'contracts' | 'dncEntries' | 'pbkMemories' | 'pbkFeedback' | 'pbkIntentEvents' | 'pbkKnowledge' | 'status'): Defaults to 'all'.
  - limit (number, 1..80): Max items per array section. Larger sections are sliced from the newest end.

Returns:
  { section: '...', state: {...selected slice...}, status: {revision, host, port, startedAt, ...} }`,
      inputSchema: GetStateInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const full = await bridgeRequest<Record<string, unknown>>({
          method: 'GET',
          path: '/state',
        });
        const section = params.section;
        const limit = params.limit;
        const slice = (key: string): unknown => {
          const value = full[key];
          if (!Array.isArray(value)) return value;
          return value.slice(0, limit);
        };
        let payload: Record<string, unknown>;
        if (section === 'all') {
          payload = {
            status: full.status,
            approvals: slice('approvals'),
            activity: slice('activity'),
            brainDocs: slice('brainDocs'),
            leadImports: slice('leadImports'),
            analyzerRuns: slice('analyzerRuns'),
            calls: slice('calls'),
            messages: slice('messages'),
            appointments: slice('appointments'),
            leadStageTransitions: slice('leadStageTransitions'),
            contracts: slice('contracts'),
            dncEntries: slice('dncEntries'),
            pbkMemories: slice('pbkMemories'),
            pbkFeedback: slice('pbkFeedback'),
            pbkIntentEvents: slice('pbkIntentEvents'),
            pbkKnowledge: slice('pbkKnowledge'),
            avaLearningRequests: slice('avaLearningRequests'),
            repairItems: slice('repairItems'),
            offerOverrides: slice('offerOverrides'),
          };
        } else {
          payload = { [section]: slice(section), status: full.status };
        }
        const out = { section, state: payload };
        return {
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
          structuredContent: out,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_list_agents',
    {
      title: 'List PBK agent registry',
      description: `Return the live PBK agent registry — ids, roles, capabilities, versions, and orchestration hierarchy. Useful for capability-matching, skill transfer targeting, and fleet health checks.

Args:
  - capability (string, optional): Filter to agents with this capability (e.g. 'negotiation', 'closing').
  - includeInactive (boolean): Include standby/inactive agents. Defaults false.

Returns:
  { ok, agents: [...], count, capabilities: [...], snapshot: { ok, result, required, degraded } }`,
      inputSchema: ListAgentsInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('listAgents', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_transfer_agent_skill',
    {
      title: 'Transfer skill between agents',
      description: `Copy a proven skill from one PBK agent to one or more target agents. Optionally creates a versioned copy with rollback path. The bridge records the transfer event, updates memory, and queues approval if the target agent is approval-gated.

Args:
  - skillName (string, required): The skill label, e.g. "Tactical Empathy".
  - skillSource (string): Reference: book, dataset, self-programmed, etc.
  - fromAgentId (string, required): Donor agent (e.g. 'ava').
  - toAgentIds (string[], required): Recipient agent IDs.
  - versioned (boolean): Creates rollback snapshot. Recommended true.
  - confidence (number 0-1): Initial confidence on the receiving end.
  - requestedBy (string): Actor label for audit trail.

Returns:
  { ok, transferId, from, to, skillName, versioned, queuedApprovals: [...] }`,
      inputSchema: TransferAgentSkillInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('transferAgentSkill', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'pbk_launch_browser_research',
    {
      title: 'Queue BrowserOS research from Rex',
      description: `Ask the PBK bridge to route a browser-native research request through the BrowserOS lane without leaving the existing Brain workflow.

Args:
  - query (string, required): Listing URL, public-record prompt, or natural-language request such as "Use BrowserOS to inspect 202 Cherry Ln on Zillow."
  - requestedBy (string): Optional actor label.
  - source (string): Optional source label for auditing.

Returns:
  { ok, answer, citations, job, tooling: { browserOs } }`,
      inputSchema: LaunchBrowserResearchInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke('launchBrowserResearch', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatBridgeError(error) }],
          isError: true,
        };
      }
    }
  );
}
