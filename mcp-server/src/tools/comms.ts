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

const SendColdEmailInput = z
  .object({
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
    email: z.string().email().optional(),
    templateId: z.string().optional().describe("probate, absentee, high-equity, or a custom template label."),
    campaignId: z.string().optional(),
    allowResendFallback: z.boolean().optional(),
  })
  .strict();

const ScheduleAppointmentInput = z
  .object({
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
    email: z.string().email().optional(),
    phone: PhoneSchema.optional(),
    startTime: z.string().min(4).describe("ISO timestamp for the booked slot."),
    timezone: z.string().optional(),
    source: z.string().optional(),
    notes: z.string().optional(),
    bookingUrl: z.string().optional(),
  })
  .strict();

const HandleReplyIntentInput = z
  .object({
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
    email: z.string().email().optional(),
    phone: PhoneSchema.optional(),
    body: z.string().min(1).describe("Inbound reply text to classify and route."),
    channel: z.string().optional(),
    provider: z.string().optional(),
    startTime: z.string().optional().describe("Optional explicit booking slot from the upstream provider."),
    timezone: z.string().optional(),
    bookingUrl: z.string().optional(),
    autoDialImmediate: z.boolean().optional().describe("Override whether 'call me now' replies should be routed directly into Telnyx."),
    autoSendFollowUp: z.boolean().optional().describe("Whether to auto-send the drafted follow-up through the bridge email path."),
    syncCalendar: z.boolean().optional().describe("Whether to create a provider-backed calendar event when the reply contains a concrete slot."),
    syncCrm: z.boolean().optional().describe("Whether to emit a formal lead-stage transition payload to the configured CRM webhook."),
    senderProfile: z.enum(["warm", "cold"]).optional().describe("Sender profile to use if the follow-up auto-sends."),
  })
  .strict();

const GetReplyTemplatesInput = z
  .object({
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    address: z.string().optional(),
    email: z.string().email().optional(),
    phone: PhoneSchema.optional(),
    body: z.string().optional().describe("Optional inbound reply text used to choose the best template."),
    channel: z.string().optional(),
    provider: z.string().optional(),
    startTime: z.string().optional().describe("Optional explicit booking slot to influence booking-hold versus booking-link selection."),
    timezone: z.string().optional(),
    bookingUrl: z.string().optional(),
  })
  .strict();

const InspectStreakPipelineInput = z
  .object({
    refresh: z.boolean().optional().describe("Force a fresh read from Streak instead of cached stage/field metadata."),
    expectedStages: z.array(z.string()).optional().describe("Optional PBK stage list to validate against the target Streak pipeline."),
    requestedBy: z.string().optional(),
  })
  .strict();

const GetStreakBootstrapPlanInput = z
  .object({
    refresh: z.boolean().optional().describe("Force a fresh Streak schema read before generating the bootstrap plan."),
    expectedStages: z.array(z.string()).optional().describe("Optional PBK stages to validate and plan against."),
    requestedBy: z.string().optional(),
  })
  .strict();

const BootstrapStreakPipelineInput = z
  .object({
    mode: z.enum(["plan", "request_approval", "apply"]).optional().describe("Generate the plan, queue an approval-backed admin task, or apply the missing schema directly."),
    refresh: z.boolean().optional(),
    expectedStages: z.array(z.string()).optional(),
    requestedBy: z.string().optional(),
    requiresApproval: z.boolean().optional().describe("Used when mode=request_approval to explicitly require approval."),
    dryRun: z.boolean().optional().describe("Used when mode=request_approval so the queued admin task stays in dry-run mode until explicitly approved for live execution."),
    command: z.string().optional().describe("Optional admin command text recorded with the task."),
  })
  .strict();

const RouteAdminCommandInput = z
  .object({
    command: z.string().min(1).describe("Plain-language Rex admin command such as 'bootstrap Streak now' or 'queue the Streak schema fix for approval'."),
    requestedBy: z.string().optional().describe("Optional actor label, defaults to Rex in the bridge."),
    requiresApproval: z.boolean().optional().describe("Optional override for generic admin requests when approval handling should be explicit."),
    dryRun: z.boolean().optional().describe("Optional override for queued admin tasks so Rex can keep them in dry-run mode until approval."),
    expectedStages: z.array(z.string()).optional().describe("Optional PBK Streak stage list used when the command routes into a Streak inspection or bootstrap action."),
  })
  .strict();

const GetAdminPersistenceStatusInput = z
  .object({})
  .strict();

const GetDocuSignProviderStatusInput = z
  .object({})
  .strict();

export function registerCommsTools(server: McpServer): void {
  server.registerTool(
    "pbk_send_cold_email",
    {
      title: "Send a personalized cold email",
      description: `Generate and send a cold email using the bridge's Brain context. Prefers Instantly when configured and falls back to the cold sender email path when allowed.

Args:
  - leadId, leadName, address, email: Lead context.
  - templateId (string): Optional template hint like probate or absentee.
  - campaignId (string): Optional Instantly campaign identifier.
  - allowResendFallback (boolean): Defaults to true.

Returns:
  { ok, provider, email, content, brainInfo, delivery, message }`,
      inputSchema: SendColdEmailInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("sendColdEmail", params);
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
    "pbk_schedule_appointment",
    {
      title: "Schedule a lead appointment",
      description: `Create or update a scheduled appointment record for a seller follow-up, calendar booking, or acquisition call handoff.

Args:
  - leadId, leadName, address, email, phone: Lead context.
  - startTime (string, required): ISO timestamp for the appointment.
  - timezone (string): Defaults to America/New_York in the bridge.
  - source, notes, bookingUrl: Optional booking metadata.

Returns:
  { ok: true, appointment, nextStep }`,
      inputSchema: ScheduleAppointmentInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("scheduleAppointment", params);
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
    "pbk_get_reply_templates",
    {
      title: "Preview reply templates by intent",
      description: `Return the bridge's reply-template catalog plus the selected template for the supplied lead and reply context.

Args:
  - leadId, leadName, address, email, phone: Optional lead context.
  - body (string): Optional inbound reply text used for intent classification.
  - channel, provider: Optional source labels.
  - startTime, timezone, bookingUrl: Optional booking metadata.

Returns:
  { ok, reply, selected, templates }`,
      inputSchema: GetReplyTemplatesInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("getReplyTemplates", params);
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
    "pbk_inspect_streak_pipeline",
    {
      title: "Inspect Streak pipeline readiness",
      description: `Return the bridge's Streak readiness report so Rex can verify whether the configured Streak pipeline has the stages and fields PBK expects.

Args:
  - refresh (boolean): Force a live read from Streak.
  - expectedStages (string[]): Optional PBK stages to validate.
  - requestedBy (string): Optional actor label.

Returns:
  { ok, provider, pipeline, stageMap, fieldMap, stageMappings, fieldMappings, availableStages, availableFields, readiness, errors }`,
      inputSchema: InspectStreakPipelineInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("inspectStreakPipeline", params);
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
    "pbk_get_streak_bootstrap_plan",
    {
      title: "Generate a Streak bootstrap plan",
      description: `Turn the bridge's Streak readiness report into a concrete PBK schema plan listing the missing stages and fields needed for live CRM sync.

Args:
  - refresh (boolean): Force a live read from Streak.
  - expectedStages (string[]): Optional PBK stage list to validate.
  - requestedBy (string): Optional actor label.

Returns:
  { ok, report, plan }`,
      inputSchema: GetStreakBootstrapPlanInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("getStreakBootstrapPlan", params);
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
    "pbk_bootstrap_streak_pipeline",
    {
      title: "Queue or apply a Streak bootstrap",
      description: `Use the bridge to either plan, request approval for, or apply the missing Streak schema needed for PBK transition sync.

Args:
  - mode ('plan'|'request_approval'|'apply'): Desired execution mode.
  - refresh (boolean): Force a live Streak read first.
  - expectedStages (string[]): Optional PBK stage list.
  - requestedBy (string): Optional actor label.
  - requiresApproval, dryRun, command: Admin-task options when mode=request_approval.

Returns:
  { ok, mode, report, plan, approvalTask?, preview?, applyResult?, applied }`,
      inputSchema: BootstrapStreakPipelineInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("bootstrapStreakPipeline", params);
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
    "pbk_route_admin_command",
    {
      title: "Route a Rex admin command",
      description: `Send one plain-language admin request through the bridge's Rex routing layer. The bridge will inspect the text, choose the right Streak/admin action, and execute or queue the underlying flow automatically.

Args:
  - command (string, required): Plain-language admin request.
  - requestedBy (string): Optional actor label.
  - requiresApproval, dryRun: Optional admin-task overrides when the route falls back to the generic admin queue.
  - expectedStages (string[]): Optional PBK Streak stage list when the command routes into Streak schema work.

Returns:
  { ok, routedTo, provider, mode, answer, result }`,
      inputSchema: RouteAdminCommandInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("routeAdminCommand", params);
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
    "pbk_get_admin_persistence_status",
    {
      title: "Read admin persistence status",
      description: `Return the bridge's persistence status for admin-managed runtime settings, including whether the active Telnyx caller ID is stored only in PBK state or also mirrored to Render.

Returns:
  { ok, telnyxCallerId: { value, persistedToStateBackend, stateBackend, lastChangedAt, lastValidatedAt, render: { configured, mirrored, syncStatus, lastSyncedAt, lastError }, summary } }`,
      inputSchema: GetAdminPersistenceStatusInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("getAdminPersistenceStatus", params);
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
    "pbk_get_docusign_provider_status",
    {
      title: "Read DocuSign provider status",
      description: `Return the bridge's DocuSign readiness, including whether the private key was loaded from env or path, whether it parses successfully, and any configuration issues blocking JWT auth.

Returns:
  { ok, configured, ready, authHost, restBase, missing, issues, summary, privateKey: { source, path, rawLength, lineCount, headerPresent, footerPresent, looksTruncated, parsed, parseError } }`,
      inputSchema: GetDocuSignProviderStatusInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("getDocuSignProviderStatus", params);
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
    "pbk_handle_reply_intent",
    {
      title: "Classify and escalate an inbound reply",
      description: `Run the bridge's reply-intent automation for an inbound email or messaging response. This can mark DNC, move a lead warm, create a booking-request appointment, trigger an immediate-call approval, persist a formal lead-stage transition, and optionally sync that transition to a CRM webhook.

Args:
  - body (string, required): Inbound reply text.
  - leadId, leadName, address, email, phone: Lead context.
  - channel, provider: Optional source labels.
  - startTime, timezone, bookingUrl: Optional explicit booking metadata from the upstream webhook.
  - autoDialImmediate, autoSendFollowUp, syncCalendar, syncCrm: Optional execution overrides.
  - senderProfile ('warm'|'cold'): Sender identity for optional follow-up send.

Returns:
  { ok, reply, leadStage, leadImport, appointment?, approval?, telnyxCall?, calendarEvent?, calendarSync?, responseDraft?, followUpMessage?, followUpDelivery?, leadTransition?, crmSync?, notification?, dncEntry? }`,
      inputSchema: HandleReplyIntentInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const result = await bridgeInvoke("handleReplyIntent", params);
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
