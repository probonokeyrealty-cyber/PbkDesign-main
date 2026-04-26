import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bridgeInvoke, bridgeRequest, formatBridgeError } from "../client.js";

const GetBrainStateInput = z
  .object({
    query: z.string().optional().describe("Optional natural-language query. Bridge tries to ground its answer in current brainDocs."),
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
        "contracts",
        "dncEntries",
        "status",
      ])
      .default("all")
      .describe("Which slice of the bridge state to return. Use a section to keep response small."),
    limit: z.number().int().min(1).max(80).default(20).describe("Max items per array section."),
  })
  .strict();

export function registerBrainTools(server: McpServer): void {
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
  - section ('all' | 'approvals' | 'activity' | 'brainDocs' | 'leadImports' | 'analyzerRuns' | 'calls' | 'messages' | 'contracts' | 'dncEntries' | 'status'): Defaults to 'all'.
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
            contracts: slice("contracts"),
            dncEntries: slice("dncEntries"),
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
}
