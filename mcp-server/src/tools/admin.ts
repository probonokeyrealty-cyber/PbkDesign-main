import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bridgeInvoke, bridgeRequest, formatBridgeError } from "../client.js";

const ClassifyParticipantInput = z
  .object({
    transcriptStart: z.string().min(2).describe("The first few seller or agent sentences from the conversation."),
    leadName: z.string().optional(),
    address: z.string().optional(),
    email: z.string().email().optional(),
  })
  .strict();

const GetParticipantProfileInput = z
  .object({
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
    email: z.string().email().optional(),
  })
  .strict();

const SellerDocsInput = z
  .object({
    leadName: z.string().optional(),
    address: z.string().optional(),
    email: z.string().email(),
    senderProfile: z.enum(["warm", "cold"]).default("warm"),
    selectedDocuments: z.array(z.string()).min(1),
    documentSet: z.record(z.string()).describe("Map of document type -> plaintext content from the analyzer workspace."),
    selectedPathLabel: z.string().optional(),
  })
  .strict();

const AdminRequestInput = z
  .object({
    command: z.string().min(2),
    provider: z.string().optional(),
    action: z.string().optional(),
    requestedBy: z.string().optional(),
    payload: z.record(z.any()).optional(),
  })
  .strict();

const AdminTaskUpdateInput = z
  .object({
    taskId: z.string().min(2),
    status: z.string().min(2),
    actor: z.string().optional(),
    notes: z.string().optional(),
    payload: z.record(z.any()).optional(),
  })
  .strict();

const PrepareContractInput = z
  .object({
    leadName: z.string().optional(),
    address: z.string().optional(),
    email: z.string().optional(),
    amount: z.number().nonnegative().optional(),
    contractPath: z.string().optional(),
    pathId: z.string().optional(),
    path: z.string().optional(),
    dealType: z.string().optional(),
    contractType: z.string().optional(),
    selectedPath: z.string().optional(),
    selectedPathLabel: z.string().optional(),
    templateId: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();

const UnderwritingSignInput = z
  .object({
    contractId: z.string().min(2),
    reviewerEmail: z.string().email().optional(),
    reviewerName: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();

const ContractLawyerReviewInput = z
  .object({
    leadName: z.string().optional(),
    address: z.string().optional(),
    email: z.string().email().optional(),
    amount: z.number().nonnegative().optional(),
    contractPath: z.string().optional(),
    pathId: z.string().optional(),
    path: z.string().optional(),
    dealType: z.string().optional(),
    contractType: z.string().optional(),
    selectedPath: z.string().optional(),
    selectedPathLabel: z.string().optional(),
    templateId: z.string().optional(),
    reviewerEmail: z.string().email().optional(),
    reviewerName: z.string().optional(),
    sellerNotice: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();

const ReloadContractTemplatesInput = z
  .object({
    reason: z.string().optional(),
    source: z.string().optional(),
    actor: z.string().optional(),
  })
  .strict();

async function bridgeJson(path: string, method: "GET" | "POST" | "PUT", body?: unknown) {
  return bridgeRequest({
    method,
    path,
    body,
  });
}

function registerProviderAdminTool(
  server: McpServer,
  name: string,
  title: string,
  provider: string,
  defaultAction: string,
  description: string,
) {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: AdminRequestInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeJson("/api/admin/request", "POST", {
          ...params,
          provider: params.provider || provider,
          action: params.action || defaultAction,
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

export function registerAdminTools(server: McpServer): void {
  server.registerTool(
    "pbk_classify_participant",
    {
      title: "Classify seller or agent sophistication",
      description: "Classify a live conversation opener into seller vs agent and novice/intermediate/expert so Ava can adjust tone and strategy.",
      inputSchema: ClassifyParticipantInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("classifyParticipant", params);
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
    "pbk_get_participant_profile",
    {
      title: "Read the saved participant profile",
      description: "Return the latest persisted seller-or-agent profile for a lead so Ava can tailor tone and strategy consistently.",
      inputSchema: GetParticipantProfileInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const query = new URLSearchParams();
        Object.entries(params)
          .filter(([, value]) => value != null && value !== "")
          .forEach(([key, value]) => {
            query.set(key, String(value));
          });
        const result = await bridgeJson(`/api/participants/profile?${query.toString()}`, "GET");
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
    "pbk_send_seller_docs",
    {
      title: "Send seller documents",
      description: "Email a chosen set of PBK documents from the warm business inbox or cold sender profile.",
      inputSchema: SellerDocsInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeJson("/api/send-seller-docs", "POST", params);
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
    "pbk_get_quotas",
    {
      title: "Read runtime quotas",
      description: "Return the bridge's current operational quotas for Instantly, Telnyx, documents, and admin queues.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const result = await bridgeJson("/api/quotas", "GET");
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
    "pbk_request_admin_action",
    {
      title: "Queue an admin action",
      description: "Create an approval-backed admin task for Instantly, Telnyx, contracts, Render, or Supabase.",
      inputSchema: AdminRequestInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeJson("/api/admin/request", "POST", params);
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
    "pbk_list_admin_tasks",
    {
      title: "List admin tasks",
      description: "Return the bridge's pending and historical admin tasks.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const result = await bridgeJson("/api/admin/tasks", "GET");
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
    "pbk_update_admin_task",
    {
      title: "Approve or update an admin task",
      description: "Change an admin task's state to approved, rejected, complete, or warning.",
      inputSchema: AdminTaskUpdateInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeJson(`/api/admin/tasks/${params.taskId}`, "PUT", {
          status: params.status,
          actor: params.actor,
          notes: params.notes,
          payload: params.payload,
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
    "pbk_prepare_contract",
    {
      title: "Prepare a contract for underwriting",
      description: "Choose a contract template from the bridge library and create a prepared contract record.",
      inputSchema: PrepareContractInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeJson("/api/contracts/prepare", "POST", params);
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
    "pbk_underwriting_sign",
    {
      title: "Trigger underwriting sign-off",
      description: "Send a prepared contract into the underwriting / DocuSign path.",
      inputSchema: UnderwritingSignInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeJson("/api/underwriting/sign", "POST", params);
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
    "pbk_contract_lawyer_review",
    {
      title: "Run the contract lawyer workflow",
      description: "Select the correct agreement, prepare the contract, and queue underwriting approval before DocuSign goes out.",
      inputSchema: ContractLawyerReviewInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeJson("/api/contracts/lawyer-review", "POST", params);
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
    "pbk_reload_contract_templates",
    {
      title: "Reload contract template paths",
      description: "Refresh the bridge contract path library from the contracts folder after template, field-map, or negotiation script updates.",
      inputSchema: ReloadContractTemplatesInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeJson("/api/contracts/reload", "POST", params);
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

  registerProviderAdminTool(
    server,
    "pbk_instantly_admin",
    "Instantly admin action",
    "instantly",
    "create_email_domain",
    "Queue an approval-backed Instantly infrastructure change such as adding a domain, warmup, or sending-limit change.",
  );
  registerProviderAdminTool(
    server,
    "pbk_telnyx_admin",
    "Telnyx admin action",
    "telnyx",
    "purchase_number",
    "Queue a Telnyx action such as buying numbers, changing caller ID, or routing updates.",
  );
  registerProviderAdminTool(
    server,
    "pbk_contract_admin",
    "Contract template admin action",
    "contract-admin",
    "add_template",
    "Queue a contract library update such as adding, updating, or retiring a template.",
  );
  registerProviderAdminTool(
    server,
    "pbk_render_admin",
    "Render admin action",
    "render",
    "update_env_var",
    "Queue a Render infrastructure change such as env-var updates, restarts, or rollbacks.",
  );
  registerProviderAdminTool(
    server,
    "pbk_supabase_admin",
    "Supabase admin action",
    "supabase",
    "run_migration",
    "Queue a database migration, schema change, or backup task.",
  );
}
