import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bridgeInvoke, bridgeRequest, formatBridgeError } from "../client.js";

const GetBrainStateInput = z
  .object({
    query: z.string().optional().describe("Optional natural-language query. Bridge tries to ground its answer in current brainDocs."),
  })
  .strict();

const GetBrainEmailContextInput = z
  .object({
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
    email: z.string().optional(),
    templateId: z.string().optional().describe("Optional cold-email template hint such as probate, absentee, or high-equity."),
    requestedBy: z.string().optional(),
  })
  .strict();

const IngestResearchDocInput = z
  .object({
    title: z.string().min(1).describe("Document title (shows on the Brain page)."),
    source: z.string().optional().describe("Where it came from (URL, paper title, internal team name)."),
    summary: z.string().optional(),
    excerpt: z.string().optional(),
    citation: z.string().optional(),
    kind: z.enum(["note", "article", "paper", "transcript", "playbook"]).optional(),
    topic: z.string().optional().describe("E.g., 'Tampa probate', 'wholesaling laws', 'Telnyx setup'."),
    tags: z.array(z.string()).optional(),
  })
  .strict();

const GetStateInput = z
  .object({
    section: z
      .enum([
        "all",
        "approvals",
        "activity",
        "brainDocs",
        "leadImports",
        "analyzerRuns",
        "calls",
        "messages",
        "appointments",
        "leadStageTransitions",
        "contracts",
        "dncEntries",
        "pbkMemories",
        "pbkFeedback",
        "pbkIntentEvents",
        "pbkKnowledge",
        "status",
      ])
      .default("all")
      .describe("Which slice of the bridge state to return. Use a section to keep response small."),
    limit: z.number().int().min(1).max(80).default(20).describe("Max items per array section."),
  })
  .strict();

const LaunchBrowserResearchInput = z
  .object({
    query: z.string().min(1).describe("Natural-language browser research request, URL, or listing/property prompt for BrowserOS."),
    requestedBy: z.string().optional().describe("Actor label recorded in the bridge activity feed."),
    source: z.string().optional().describe("Origin label such as 'brain', 'shell-brain', or 'agent-console'."),
  })
  .strict();

const AddPbkMemoryInput = z
  .object({
    tenantId: z.string().optional(),
    leadId: z.string().optional(),
    agentName: z.string().optional(),
    memoryType: z.string().optional().describe("episodic, semantic, objection, seller-preference, etc."),
    content: z.string().min(1).describe("The memory text Ava/Rex should be able to recall later."),
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
    query: z.string().optional().describe("What Ava/Rex is trying to remember."),
    memoryType: z.string().optional(),
    limit: z.number().int().min(1).max(20).optional(),
    includeGlobal: z.boolean().optional(),
  })
  .strict();

const RecordPbkFeedbackInput = z
  .object({
    tenantId: z.string().optional(),
    leadId: z.string().optional(),
    callId: z.string().optional(),
    agentName: z.string().optional(),
    agentAction: z.string().optional(),
    humanDecision: z.string().optional().describe("approved, rejected, needs_revision, false_positive, etc."),
    transcriptSnippet: z.string().optional(),
    outcomeLabel: z.string().optional(),
    approvalId: z.string().optional(),
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
    persist: z.boolean().optional().describe("Defaults true. Set false for read-only classification."),
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

export function registerBrainTools(server: McpServer): void {
  server.registerTool(
    "pbk_get_brain_email_context",
    {
      title: "Build Brain email context",
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
        const result = await bridgeInvoke("getBrainEmailContext", params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatBridgeError(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "pbk_get_brain_state",
    {
      title: "Query the OpenClaw Brain",
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
        const result = await bridgeInvoke("getBrainState", params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatBridgeError(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "pbk_add_memory",
    {
      title: "Store PBK memory",
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
        const result = await bridgeInvoke("addPbkMemory", params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatBridgeError(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "pbk_recall_memory",
    {
      title: "Recall PBK memory",
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
        const result = await bridgeInvoke("recallPbkMemory", params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatBridgeError(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "pbk_record_feedback",
    {
      title: "Record PBK feedback",
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
        const result = await bridgeInvoke("recordPbkFeedback", params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatBridgeError(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "pbk_detect_intent",
    {
      title: "Detect wholesale intent",
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
        const result = await bridgeInvoke("detectPbkIntent", params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatBridgeError(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "pbk_record_knowledge",
    {
      title: "Record PBK knowledge fact",
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
        const result = await bridgeInvoke("recordPbkKnowledge", params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatBridgeError(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "pbk_query_knowledge",
    {
      title: "Query PBK knowledge graph",
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
        const result = await bridgeInvoke("queryPbkKnowledge", params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatBridgeError(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "pbk_run_agent_pipeline",
    {
      title: "Run PBK agent pipeline",
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
        const result = await bridgeInvoke("runPbkAgentPipeline", params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatBridgeError(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "pbk_ingest_research_doc",
    {
      title: "Add a doc to the Brain",
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
        const result = await bridgeInvoke("ingestResearchDoc", params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatBridgeError(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "pbk_get_state",
    {
      title: "Read bridge state",
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
        const full = await bridgeRequest<Record<string, unknown>>({ method: "GET", path: "/state" });
        const section = params.section;
        const limit = params.limit;
        const slice = (key: string): unknown => {
          const value = full[key];
          if (!Array.isArray(value)) return value;
          return value.slice(0, limit);
        };
        let payload: Record<string, unknown>;
        if (section === "all") {
          payload = {
            status: full.status,
            approvals: slice("approvals"),
            activity: slice("activity"),
            brainDocs: slice("brainDocs"),
            leadImports: slice("leadImports"),
            analyzerRuns: slice("analyzerRuns"),
            calls: slice("calls"),
            messages: slice("messages"),
            appointments: slice("appointments"),
            leadStageTransitions: slice("leadStageTransitions"),
            contracts: slice("contracts"),
            dncEntries: slice("dncEntries"),
            pbkMemories: slice("pbkMemories"),
            pbkFeedback: slice("pbkFeedback"),
            pbkIntentEvents: slice("pbkIntentEvents"),
            pbkKnowledge: slice("pbkKnowledge"),
          };
        } else {
          payload = { [section]: slice(section), status: full.status };
        }
        const out = { section, state: payload };
        return {
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
          structuredContent: out,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatBridgeError(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "pbk_launch_browser_research",
    {
      title: "Queue BrowserOS research from Rex",
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
        const result = await bridgeInvoke("launchBrowserResearch", params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatBridgeError(error) }],
          isError: true,
        };
      }
    },
  );
}
