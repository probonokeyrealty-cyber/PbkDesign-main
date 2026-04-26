import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bridgeInvoke, formatBridgeError } from "../client.js";

const PhoneSchema = z.string().min(7).describe("E.164 or US-formatted phone (e.g., '+1 614-555-0142').");

const CheckDncInput = z.object({ phone: PhoneSchema }).strict();

const TelnyxSmsInput = z
  .object({
    to: PhoneSchema,
    from: z.string().optional().describe("Sending number / shortcode. Falls back to the bridge's default."),
    body: z.string().min(1).max(1600).describe("SMS text. Bridge will block if the recipient is on DNC."),
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
  })
  .strict();

const TelnyxCallInput = z
  .object({
    to: PhoneSchema,
    from: z.string().optional(),
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();

const SendContractInput = z
  .object({
    leadName: z.string().min(1),
    address: z.string().min(1),
    amount: z.number().nonnegative().describe("Contract amount in USD."),
    template: z.enum(["assignment", "purchase", "release", "amendment"]).optional(),
    signers: z
      .array(z.object({ name: z.string(), email: z.string().email() }).strict())
      .min(1)
      .optional()
      .describe("Recipients. Bridge default fanout is used if omitted."),
    notes: z.string().optional(),
  })
  .strict();

const SkipTraceInput = z
  .object({
    leadName: z.string().optional(),
    address: z.string().min(1).describe("Subject property address."),
  })
  .strict();

const SlackNotifyInput = z
  .object({
    text: z.string().min(1).describe("Plain text body. Bridge appends actor/category metadata."),
    target: z.string().optional().describe("Optional reference (lead/property)."),
  })
  .strict();

export function registerCommsTools(server: McpServer): void {
  server.registerTool(
    "pbk_check_dnc",
    {
      title: "DNC lookup",
      description: `Check if a phone number is on the bridge's DNC list. Always run this before pbk_send_sms or pbk_make_call when reaching out to a lead the first time.

Args:
  - phone (string, required): E.164 or formatted US number.

Returns:
  { ok: boolean, phone, blocked: boolean, reason?: string, match?: {...} }`,
      inputSchema: CheckDncInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("checkDNC", params);
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
    "pbk_send_sms",
    {
      title: "Send SMS via Telnyx",
      description: `Send a one-off SMS through the bridge's Telnyx integration. Bridge automatically calls DNC first and refuses to send to blocked numbers.

Args:
  - to (string, required): Destination phone.
  - from (string): Sending number; bridge default used when omitted.
  - body (string, required): Message body. Max ~1600 chars.
  - leadId, leadName, address (strings): Lead context for the activity feed.

Returns:
  { ok: boolean, blocked?: true, reason?, message: {id, to, from, body, leadId, leadName, status, createdAt} }`,
      inputSchema: TelnyxSmsInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("telnyx_sms", params);
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
    "pbk_make_call",
    {
      title: "Initiate a Telnyx call",
      description: `Open a Telnyx call leg through the bridge. DNC is enforced — call is blocked if the number matches.

Args:
  - to (string, required): Destination phone.
  - from (string): Outbound number; bridge default used when omitted.
  - leadId, leadName, address (strings): Lead context.
  - notes (string): Pre-call note for the activity feed.

Returns:
  { ok: boolean, blocked?: true, reason?, call: {id, to, from, leadId, leadName, status: 'live', createdAt} }`,
      inputSchema: TelnyxCallInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("telnyx_call", params);
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
    "pbk_send_contract",
    {
      title: "Send a contract via DocuSign",
      description: `Generate a contract envelope from a template and send for signature.

Args:
  - leadName (string, required), address (string, required), amount (number, required).
  - template ('assignment'|'purchase'|'release'|'amendment'): Defaults to 'assignment'.
  - signers (array of {name, email}): Optional. Bridge defaults to the lead contact when omitted.
  - notes (string): Optional reviewer note.

Returns:
  { ok: true, contract: {id, leadName, address, amount, status: 'sent', createdAt}, envelope?: {...} }`,
      inputSchema: SendContractInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("sendDocuSign", params);
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
    "pbk_skip_trace",
    {
      title: "Skip-trace a lead",
      description: `Run skip-trace lookup for a property's owner. Returns probable phone/email contacts and source confidence.

Args:
  - leadName (string): Owner name when known.
  - address (string, required): Subject property.

Returns:
  { ok: true, contacts: Array<{name, phone, email, confidence, source}>, summary: string }`,
      inputSchema: SkipTraceInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("skipTrace", params);
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
    "pbk_slack_notify",
    {
      title: "Slack notify (via bridge)",
      description: `Forward a message into the bridge's Slack notify path. Useful for surfacing decisions ("offer accepted", "DNC hit") without leaving the LLM context.

Args:
  - text (string, required): Plain text body.
  - target (string): Optional reference label (lead, property).

Returns:
  { ok: true, message: {...} }`,
      inputSchema: SlackNotifyInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("slackNotify", params);
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
