import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bridgeInvoke, bridgeRequest, formatBridgeError } from "../client.js";

const PropertyTypeEnum = z.enum(["house", "land", "multi", "commercial", "mobile"]);

const AnalyzeDealInput = z
  .object({
    address: z.string().min(2).describe("Property street + city. Used as the analyzer label."),
    type: PropertyTypeEnum.optional().describe("Property type. Defaults to 'house'."),
    price: z.number().nonnegative().optional().describe("Asking price (USD)."),
    agreedPrice: z.number().nonnegative().optional().describe("Negotiated price (USD)."),
    beds: z.number().int().nonnegative().optional(),
    baths: z.number().nonnegative().optional(),
    sqft: z.number().nonnegative().optional(),
    year: z.number().int().min(1800).max(2100).optional(),
    repairs: z.number().nonnegative().optional().describe("Estimated repair cost (USD)."),
    lotSize: z.number().nonnegative().optional().describe("Lot size in acres."),
    contact: z.enum(["owner", "agent", "investor", "wholesaler"]).optional(),
    notes: z.string().optional(),
  })
  .strict();

const LeadIntakeInput = z
  .object({
    leadId: z.string().optional().describe("Stable lead ID. If omitted the bridge generates one."),
    source: z.string().optional().describe("Where the lead came from (e.g. 'batchdata-probate-apr25.csv')."),
    seller: z
      .object({
        name: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
      })
      .partial()
      .optional(),
    property: z
      .object({
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
      })
      .partial()
      .optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();

export function registerDealTools(server: McpServer): void {
  server.registerTool(
    "pbk_analyze_deal",
    {
      title: "Analyze a deal",
      description: `Run the OpenClaw analyzer over a single property. Computes ARV, MAO, target offer, repair estimate, and equity context.

The analyzer call is recorded into bridge state (analyzerRuns + activity feed) so the dashboard reflects it within ~10s.

Args:
  - address (string): Property address (required).
  - type ('house'|'land'|'multi'|'commercial'|'mobile'): Defaults to 'house'.
  - price (number): Asking price in USD.
  - agreedPrice (number): Negotiated price in USD.
  - beds, baths, sqft, year (numbers): Property characteristics.
  - repairs (number): Repair estimate in USD.
  - lotSize (number): Lot size in acres.
  - contact ('owner'|'agent'|'investor'|'wholesaler'): Counterparty type.
  - notes (string): Free-form context.

Returns:
  Structured analyzer result with fields:
  { id, address, type, arv, mao, targetOffer, equity, repairs, summary, createdAt }

Examples:
  - "Analyze 202 Cherry Ln, Columbus OH at 3/2/1500" -> address="202 Cherry Ln, Columbus OH", beds=3, baths=2, sqft=1500
  - "What's MAO on a $185k 2008 house with $25k repairs" -> price=185000, year=2008, repairs=25000

Don't use when:
  - You only want to look up an existing run -> use pbk_get_state and read analyzerRuns.`,
      inputSchema: AnalyzeDealInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke<{ result: unknown }>("analyzeDeal", params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: { ok: true, result },
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
    "pbk_lead_intake",
    {
      title: "Ingest a lead",
      description: `Push a single lead into the bridge's leadImports queue and append a corresponding activity entry. Use this for one-off manual imports; bulk CSV intake should go through the n8n 'PBK Lead Intake' webhook.

Args:
  - leadId (string): Stable id, optional. Bridge generates one when omitted.
  - source (string): Source label (e.g., 'manual-claude', 'batchdata-probate-apr25.csv').
  - seller (object): {name, phone, email} — all optional.
  - property (object): {address, city, state} — all optional.
  - tags (string[]): Tags like ['probate', 'high-equity'].

Returns:
  { ok: boolean, leadImport: {id, source, payload, createdAt} }`,
      inputSchema: LeadIntakeInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeRequest({
          method: "POST",
          path: "/api/leads/import",
          body: params,
        });
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
