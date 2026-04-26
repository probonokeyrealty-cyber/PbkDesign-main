import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bridgeInvoke, bridgeRequest, formatBridgeError } from "../client.js";

const CreateApprovalInput = z
  .object({
    type: z.enum(["offer", "contract", "wire", "release"]).optional().describe("Approval kind. Defaults to 'offer'."),
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().min(1).describe("Property address the approval is about."),
    offerPrice: z.number().nonnegative().optional().describe("Offer amount in USD."),
    mao: z.number().nonnegative().optional().describe("Maximum allowable offer in USD."),
    notes: z.string().optional(),
  })
  .strict();

const DecideApprovalInput = z
  .object({
    id: z.string().min(1).describe("Approval id (from createApproval result or pbk_list_approvals)."),
    status: z.enum(["approved", "rejected"]).describe("Decision."),
    actor: z.string().optional().describe("Who is approving (e.g., 'Jordan'). Defaults to 'mcp-client'."),
    notes: z.string().optional(),
  })
  .strict();

const ListApprovalsInput = z
  .object({
    statusFilter: z.enum(["pending", "approved", "rejected", "all"]).default("all").describe("Filter by status."),
    limit: z.number().int().min(1).max(60).default(20),
  })
  .strict();

export function registerApprovalTools(server: McpServer): void {
  server.registerTool(
    "pbk_create_approval",
    {
      title: "Create an approval request",
      description: `Queue a new approval request in the bridge. The approval lands in the dashboard's Approval Queue immediately and \(if PBK_N8N_APPROVAL_WEBHOOK is configured on the bridge\) triggers the n8n approval-fanout flow which can notify Slack/SMS/Telegram with approve/reject links.

Args:
  - type ('offer'|'contract'|'wire'|'release'): Defaults to 'offer'.
  - leadName (string), leadId (string): Counterparty info.
  - address (string, required): Property address.
  - offerPrice (number), mao (number): Pricing context.
  - notes (string): Anything the approver needs to see.

Returns:
  { ok: true, approval: {id, type, leadId, leadName, address, offerPrice, mao, notes, status: 'pending', createdAt}, fanout?: {ok, url} }`,
      inputSchema: CreateApprovalInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("createApproval", params);
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
    "pbk_decide_approval",
    {
      title: "Approve or reject a queued approval",
      description: `Mark a pending approval as approved or rejected. This drives the same code path the dashboard's Approve/Reject buttons use, so activity feed and approval queue both update.

Args:
  - id (string, required): Approval id.
  - status ('approved'|'rejected', required).
  - actor (string): Who decided. Defaults to 'mcp-client'.
  - notes (string): Optional decision notes.

Returns:
  { ok: true, approval: {...updated...} }`,
      inputSchema: DecideApprovalInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeRequest({
          method: "PUT",
          path: `/api/approvals/${encodeURIComponent(params.id)}`,
          body: { status: params.status, actor: params.actor || "mcp-client", notes: params.notes },
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

  server.registerTool(
    "pbk_list_approvals",
    {
      title: "List approval queue",
      description: `Read approvals from the bridge state. Useful before calling pbk_decide_approval — gives you the ids and current statuses.

Args:
  - statusFilter ('pending'|'approved'|'rejected'|'all'): Defaults to 'all'.
  - limit (number, 1..60): Maximum results.

Returns:
  { ok: true, approvals: Array<{id, type, leadId, leadName, address, offerPrice, mao, notes, status, createdAt, actedAt?, actor?}> }`,
      inputSchema: ListApprovalsInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const raw = await bridgeRequest<{ ok: boolean; approvals?: unknown[] }>({
          method: "GET",
          path: "/api/approvals",
        });
        const all = Array.isArray(raw.approvals) ? raw.approvals : [];
        const filtered = (params.statusFilter === "all"
          ? all
          : all.filter((a) => (a as { status?: string }).status === params.statusFilter)
        ).slice(0, params.limit);
        const out = { ok: true, count: filtered.length, approvals: filtered };
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
