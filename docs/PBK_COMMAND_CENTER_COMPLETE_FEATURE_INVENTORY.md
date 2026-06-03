# PBK Command Center Complete Feature Inventory

Generated: 2026-05-31

Production bridge revision: `2026-05-31-provider-augmented-additives-v3`

Production status at last verification:

- Bridge health: `ok`
- State backend: `postgres`
- Production ready flag: `true`
- Required operational tables: `28/28`
- Missing required operational tables: `0`
- Native frontier additives: `10/10`
- Optional external frontier provider slots: `9`
- Configured optional external frontier providers: `0/9`
- Native fallback for optional frontier providers: `ready`
- Website status: Netlify returned `200`

This document is the broad inventory of what PBK Command Center contains today: product surfaces, agents, runtime behaviors, tools, integrations, database controls, safety rails, tests, and optional upgrade connectors.

## 1. What PBK Command Center Is

PBK Command Center is a production AI operating system for real estate wholesaling and acquisition operations. It combines:

- A modern command center dashboard.
- A hosted bridge/API runtime on Render.
- Supabase/Postgres operational state.
- Redis shared state/event coordination.
- Ava, the acquisition closer and live-call intelligence agent.
- Rex, the strategist and revenue alignment agent.
- A multi-agent registry with specialist agents.
- Live voice, transcript, emotion, memory, deal analysis, approvals, contracts, follow-up, and learning loops.
- Safety, QA, observability, approval gates, and provider health controls.

The system is not only a UI. It is a full operational runtime where agents, tools, data, approvals, communication channels, and business workflows are connected through the bridge.

## 2. Production Architecture

### 2.1 Core Runtime Layers

| Layer                   | Purpose                       | Current behavior                                                                                                                           |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Netlify dashboard       | Operator-facing web app       | Serves the modern PBK Command Center UI.                                                                                                   |
| Render bridge           | Hosted API/tool/action brain  | Owns `/health`, `/invoke`, webhooks, voice routes, provider status, schema ensure, and tool execution.                                     |
| Supabase/Postgres       | Durable structured state      | Stores memories, approvals, tool usage, safety audits, agent registry, nurture data, research additive runs, and other operational tables. |
| Redis                   | Shared call/event state       | Used for call state, singleton leases, event streams, and live state coordination.                                                         |
| AWS S3/Supabase storage | Cold storage and playback     | Stores/serves recordings and document artifacts where configured.                                                                          |
| Telnyx                  | Voice and SMS transport       | Handles inbound/outbound calls, media streaming, SMS, and recording webhooks.                                                              |
| Deepgram                | Speech-to-text                | Live call transcription with phone-safe model behavior.                                                                                    |
| ElevenLabs              | Text-to-speech                | Ava voice output and prosody control.                                                                                                      |
| DeepSeek/OpenAI/Tavily  | LLM and research intelligence | Used for reasoning, web search fallback, brain answers, and agent planning.                                                                |
| Slack                   | Approvals and notifications   | Approval messages, operator alerts, and mention routing.                                                                                   |
| DocuSign                | Contract envelope flow        | Sends/updates signing workflows with approval gating.                                                                                      |
| Streak/CRM              | CRM sync path                 | Syncs leads/deals into CRM where configured.                                                                                               |
| n8n                     | Workflow automation           | Workflow publishing and automation surface.                                                                                                |

### 2.2 Source-of-Truth Runtime

The primary bridge source of truth is:

- `scripts/openclaw-local-server.mjs`

The main React/dashboard app lives under:

- `src/app`

The active production branch is:

- `main`

The latest deployed intelligence revision is:

- `2026-05-31-provider-augmented-additives-v3`

## 3. Main User-Facing Product Surfaces

### 3.1 Command Center

Purpose: The main operating cockpit.

Built behaviors:

- Shows system stats and operational cards.
- Surfaces live calls, approvals, activity, and system diagnostics.
- Provides a Call Floor panel for finding/selecting leads and initiating approved call workflows.
- Shows provider readiness and runtime health.
- Connects to the bridge through the same production API seam used by the rest of PBK.
- Uses toast/loading/offline states so operators are not left guessing.
- Mobile behavior is supported through responsive cards and compact navigation patterns.

### 3.2 Unified Inbox

Purpose: Central view for seller communications.

Built behaviors:

- Lists seller-facing communications such as calls, SMS, and email-style messages.
- Supports compose flows through the dashboard.
- Connects messages back to leads and context where available.
- Avoids internal-only brain content in seller-facing public chat contexts.
- Supports archive/delete routes through the bridge.

### 3.3 Leads Pipeline

Purpose: Manage sellers/leads and pipeline state.

Built behaviors:

- Lead search and filtering.
- Lead detail context.
- Live bridge lead data rendering.
- Lead import support.
- Lead delete wiring through bridge routes.
- Dedupe protections so blank-address/blank-phone leads do not collapse incorrectly.
- Lead stage transitions used by nurture and revenue logic.
- Mobile card behavior for smaller screens.

### 3.4 Deal Analyzer

Purpose: Underwrite a property and analyze deal paths.

Built behaviors:

- ARV, MAO, repair, profit, and path calculations.
- Cash offer/creative finance/land-style path support.
- Analyzer state sync through `window.PBKAnalyzer.getState()` and `setState()`.
- Analyzer can load selected lead context.
- Analyzer can sync selected deal path back into the wider PBK runtime.
- Analyzer storage is namespaced and exportable.
- The user specifically asked not to touch this page during the latest UI cleanup pass, so it is preserved.

### 3.5 Agent Fleet

Purpose: View the agent ecosystem.

Built behaviors:

- Shows agent registry state.
- Uses honest runtime records rather than fake activity.
- Surfaces Ava, Rex, Hermes, Nurture Agent, Research Orchestrator, and sub-agents.
- Connects to agent handoff/orchestration smoke behavior.

### 3.6 Analytics

Purpose: View business and operational performance.

Built behaviors:

- Funnel/ROI-style analytics surfaces.
- Operational readiness/status cards.
- Runtime and provider health references.
- Links back to call/revenue learning loops.

### 3.7 Memory Analytics

Purpose: Inspect memory, knowledge, and learning behavior.

Built behaviors:

- Brain/memory analytics surface.
- Supports review of PBK memory, knowledge, and feedback loops.
- Links to call embeddings, emotional learning, and brain query surfaces.

### 3.8 Settings

Purpose: Configure guardrails and runtime behavior.

Built behaviors:

- API key and bridge connection management.
- Safe clear-key action for stale bridge sessions.
- Settings surfaces for providers, DNC/guardrails, identities, and operational configuration.
- Avoids erasing saved API key during background bridge health sync.

### 3.9 Contracts/Documents UI

Purpose: Manage contract pipeline and documents.

Built behaviors:

- Contract tabs and status filtering.
- Draft delete and void actions.
- DocuSign send path through approval gates.
- PDF/document generation routes.
- Document template reload tooling.
- Document PDF function routing through Netlify.

### 3.10 Call Recordings

Purpose: Playback and review calls.

Built behaviors:

- Recording library uses live recording state instead of static samples.
- Recording playback through signed URLs/storage routes.
- Delete route for UI and bridge storage/state.
- S3 cold archive support.
- Metadata-only smoke recordings do not spam storage errors.

### 3.11 Brain / Research Library

Purpose: Knowledge and research layer.

Built behaviors:

- Brain document ingestion.
- Brain state queries.
- Market pulse records.
- Suggested reading.
- Research docs can be saved for Rex review.
- Live web search can produce answer text, symbolic facts, and provider telemetry.

### 3.12 Keyboard, Mobile, and UI Polish

Built behaviors:

- Shortcut cheat sheet.
- Escape-to-close modal behavior.
- Responsive navigation and mobile layout support.
- Favorites/pinning behavior where configured.
- Loading spinners and toast dedupe.
- UI toolkit includes badges, cards, dialogs, drawers, sheets, tables, buttons, inputs, tooltips, tabs, switches, accordions, and other reusable components.

## 4. Agent System

PBK has a multi-agent registry. Agents are discoverable, capability-tagged, and routed through bridge-safe execution lanes.

### 4.1 Ava

Role: Primary acquisition closer, voice supervisor, and seller-facing intelligence.

Capabilities:

- Live voice conversation.
- Negotiation and closing.
- BANT qualification.
- Path locking.
- RAG/context retrieval.
- Memory retrieval.
- Turn coordination.
- Objection handling.
- Anti-repeat behavior.
- Prosody/tone adjustment.
- Tool routing through `/invoke`.

Key behaviors:

- Hears seller speech through Telnyx/Deepgram.
- Reads live lead/call context.
- Detects emotional and conversational signals.
- Locks a deal path when confidence and signals are strong enough.
- Probes for authority, need, budget, and timeline.
- Handles seller objections using coach memory and closing intelligence.
- Can consult the Nurture Agent for best SMS/email/call follow-up.
- Can run the provider-aware frontier intelligence layer for full-system sync questions.
- Avoids fake listening if no microphone/audio is present.
- Does not directly execute risky actions without guardrails.

### 4.2 Rex

Role: Strategist, research agent, revenue alignment agent, and operator co-pilot.

Capabilities:

- Strategy and research.
- Revenue alignment.
- Autonomous goal setting.
- Proactive triggers.
- Market intelligence.
- Rex decisions.
- Memory synthesis.

Key behaviors:

- Compares system state against revenue goals.
- Proposes revenue actions.
- Handles high-level business questions.
- Runs goal discovery.
- Uses research and memory context.
- Coordinates with specialized agents.
- Suggests actions without bypassing approval gates.

### 4.3 Hermes

Role: Suggest-only analyst lane.

Capabilities:

- Transcript analysis.
- Feedback review.
- Risk review.
- Pattern detection.
- Suggestions.

Key behaviors:

- Helps analyze calls and patterns.
- Suggests improvements.
- Does not directly write to providers.

### 4.4 Call Analyzer

Role: Post-call quality and transcript analysis.

Capabilities:

- Post-call analysis.
- Quality scoring.
- Failure tagging.
- Coaching recommendations.

Key behaviors:

- Reviews transcripts.
- Scores call quality.
- Tags issues like interruption, wrong script, repetition, or weak close.
- Feeds learning and emotional memory tables.

### 4.5 Prosody Tuner

Role: Voice tuning and TTS quality agent.

Capabilities:

- Voice tuning.
- Prosody.
- Emotion-aware speed/stability.
- TTS quality.
- ML/model evaluation.

Key behaviors:

- Tracks Ava voice settings.
- Advises speed, stability, and tone.
- Supports training/export paths for prosody models.

### 4.6 Script Rotator

Role: Context-aware script and objection selector.

Capabilities:

- Script management.
- Context-aware rotation.
- A/B testing patterns.
- Objection handling.
- Trust builders.
- War Manual lines.
- Anti-repeat behavior.

Key behaviors:

- Chooses scripts based on sentiment, objection, and historical outcomes.
- Avoids repeating stale lines.
- Supports script outcome recording.
- Feeds continuous improvement.

### 4.7 BANT Enforcer

Role: Qualification completeness and path-lock support.

Capabilities:

- Budget/authority/need/timeline tracking.
- Goal inference.
- Clarifying questions.
- Path locking.

Key behaviors:

- Tracks qualification facts.
- Helps Ava progress through authority, need, budget, and timeline.
- Prompts clarifying questions when facts are missing.

### 4.8 QA Agent

Role: Tool validation and reliability guard.

Capabilities:

- QA validation.
- Tool-result audit.
- Approval escalation.
- Retry policy.
- Reliability tracking.

Key behaviors:

- Validates tool outputs.
- Logs QA audits.
- Helps prevent silent provider failures.
- Can escalate questionable results.

### 4.9 Nurture Agent

Role: Follow-up recommendation and campaign/nurture orchestrator.

Capabilities:

- Nurture recommendations.
- Campaign follow-up.
- SMS/email/call planning.
- Scheduling.
- Reply handling.

Key behaviors:

- Ava can ask whether to SMS, email, or call.
- Recommends best channel and timing.
- Creates approval-gated nurture sequences.
- Processes due nurture steps.
- Pauses or adjusts when seller reply context requires it.

### 4.10 Research Orchestrator

Role: Coordinates the frontier additive intelligence layer.

Capabilities:

- Agent interop.
- Execution path search.
- Workflow induction.
- Tool discovery.
- Stopping guardrails.
- Compact memory.
- Proactive state inference.
- Desktop planning.
- Mission planning.
- Safety transparency.

Key behaviors:

- Runs all ten native frontier additives together.
- Checks optional external provider slots.
- Keeps provider writes blocked.
- Feeds Ava/Rex a single synchronized next action.

## 5. Voice and Call Pipeline

### 5.1 Inbound Calls

Built behaviors:

- Telnyx inbound webhook answers calls.
- Call media can stream to the bridge.
- Deepgram receives call audio for live transcription.
- Ava can greet and respond over Telnyx media.
- Recording can be requested for normal inbound calls.
- SMS traffic is kept away from voice-call routing.
- Inbound caller context does not fall back to the wrong seller when phone/lead ID is explicit.

### 5.2 Outbound Calls

Built behaviors:

- `telnyx_call` initiates outbound calls.
- Call Floor can select leads and initiate call workflows.
- Outbound calls are authenticated and connected to media streaming.
- Answered outbound calls get an Ava greeting instead of silence.
- Calling hours, DNC, TCPA, and approval controls are enforced.

### 5.3 Live Transcription

Built behaviors:

- Deepgram phone-safe model behavior.
- Interim/final transcript handling.
- KeepAlive during caller pauses.
- Buffered audio flush before close.
- PCMU fallback to decoded linear16 when needed.
- No-transcript diagnostics expose bytes, model, and last event.

### 5.4 Ava Speech Output

Built behaviors:

- ElevenLabs TTS is bridge-backed.
- Ava phone replies can play over Telnyx bidirectional media.
- Dynamic prosody/tone guidance is supported.
- TTS diagnostics avoid being misparsed as lead targets/provider writes.
- Anti-repeat and stale-context guards are built into live reply generation.

### 5.5 Live Call Diagnostics

Built behaviors:

- `/api/debug/live-call-status` style diagnostics.
- Last transcript and last Ava spoken output tracking.
- Call trace diagnostics preserve transcript arrays and playback send details.
- Debug scripts such as `debug:telnyx-live`.

## 6. Conversation Intelligence

PBK has layered call intelligence, not a single prompt.

Built behaviors:

- Active listening.
- Latest-turn authority.
- Context resolver before response.
- GOOD-style seller goal inference.
- BANT extraction and progression.
- Path locking across deal paths.
- Emotion and sentiment handling.
- Similar deal retrieval.
- Brain/RAG retrieval.
- Closing intelligence retrieval.
- Coach memory lookup.
- Probe question selection.
- Anti-repeat and self-correction.
- Strategic safety checks.
- Human handoff support.

Deal path examples:

- Cash offer.
- Retail buyer program / novation-style paths.
- Creative finance.
- Mortgage/timeline-aware alternatives.
- Land-style analysis.

Objection categories handled:

- "Your offer is too low."
- "This feels like a scam."
- Probate/inherited property.
- Tenant issues.
- Foreclosure/bank timeline.
- Repairs/condition.
- Spouse/partner decision.
- Moving/relocation.
- Exhaustion/headache.
- Need proof/legitimacy.

## 7. Deal and Revenue Engine

### 7.1 Deal Analysis

Built tools/behaviors:

- `analyzeDeal`
- ARV calculations.
- MAO calculations.
- Repair estimate handling.
- Assignment/profit logic.
- Property data cache.
- Property scraping adapters.
- Path-specific deal packaging.
- Analyzer-to-contract flow.

### 7.2 Revenue Engine

Built behaviors:

- Seven-figure revenue planning model.
- Revenue engine status.
- Revenue action proposals.
- Lead/campaign/action recommendations.
- Rex strategy lane.
- Approval-first operating mode.

Important note:

- Revenue math is a planning model, not a guarantee. The system still needs real lead volume and call outcomes to improve conversion.

## 8. Lead, CRM, and Contact System

Built behaviors:

- Lead import.
- Lead search.
- Lead deletion.
- Lead detail context.
- Lead stage transitions.
- Participant classification.
- Participant profile retrieval.
- CRM/Streak pipeline inspection.
- CRM bootstrap planning.
- CRM update/sync.
- Reply intent handling.
- DNC checks.
- Skip trace slot.

CRM/provider behavior:

- CRM writes are approval-gated or controlled.
- Streak provider status is surfaced.
- BatchData skip trace is optional and requires API key.

## 9. Messaging, Follow-Up, and Nurture

### 9.1 SMS

Built behaviors:

- `telnyx_sms`
- Verification SMS.
- Compose modal path.
- SMS delivery through Telnyx.
- DNC/TCPA safety checks.
- Seller reply handling.

### 9.2 Email

Built behaviors:

- `sendColdEmail`
- Instantly provider path.
- Reply templates.
- Brain email context.
- Email-style follow-up through nurture/campaign paths.

### 9.3 Nurture Sequences

Built behaviors:

- `consultNurtureAgent`
- `startNurtureSequence`
- `processDueNurtureSteps`
- `planLeadNurture`
- Nurture sequence templates.
- Active nurture instances.
- Step logs.
- Channel selection for SMS/email/call.
- Approval-gated execution.

### 9.4 Scheduling

Built behaviors:

- `scheduleAppointment`
- Calendar readiness surfaced in hosted provider checks.
- Follow-up scheduling concepts through nurture and scheduled calls.

## 10. Contracts and Documents

Built behaviors:

- `prepareContract`
- `sendContract`
- `sendDocuSign`
- `prepare_and_send_contract`
- `contractLawyerReview`
- `reloadContractTemplates`
- PDF/document delivery routes.
- DocuSign envelope integration.
- Contract approval gates.
- Contract follow-up tracking.
- Void/delete/status filter support in UI.

Safety behavior:

- Contracts are high-risk provider actions and remain approval-gated.

## 11. Memory and Knowledge System

### 11.1 Working Memory

Built behaviors:

- Redis call state.
- Per-call BANT, emotion, path, turn count, and transcript history.
- Singleton leases.
- Shared call state across hosted runtime.

### 11.2 Structured Memory

Built tables/behaviors:

- `pbk_memories`
- `pbk_feedback`
- `pbk_knowledge`
- `pbk_tool_usage`
- `coach_memory`
- `skills`
- `skill_usage`
- `ava_learning_sessions`
- `ava_active_memories`
- `pbk_tasks`
- `pbk_learning_requests`

### 11.3 Semantic/Episodic Memory

Built behaviors:

- Call embeddings schema.
- Call embedding upsert.
- Similar deal retrieval.
- Conversation memory recall.
- Brain query/RAG retrieval.
- Ava recording RAG memory.

### 11.4 Emotional Memory

Built tables/behaviors:

- `pbk_call_emotions`
- `pbk_emotional_memory`
- `pbk_emotional_learning_interactions`
- `pbk_emotional_learning_memory`
- `pbk_emotional_policy_experiments`
- `pbk_emotional_policy_outcomes`
- Emotion world-model training.
- Prosody and response adaptation.

### 11.5 Auto-Skill Learning

Built behaviors:

- `runAutoSkillLearner`
- Nightly skill learning script.
- Boosts successful skills when data qualifies.
- Can generate candidate skills from successful call transcripts.
- Inserts into memory/probe/skill surfaces with review-style behavior.

## 12. Frontier Additive Intelligence Layer

PBK now has ten native frontier additive modules. These are live as PBK-native versions today. External MEM1/NeuroSkill/MasterAgent/ToolUniverse/etc. providers are optional connector upgrades and are not fake-live.

### 12.1 ACP/AIP Agent Interop Gateway

Tool:

- `routeAcpMessage`

Behavior:

- JSON-RPC-compatible routing surface.
- Maps external agent messages to approved PBK tools.
- Keeps external writes blocked unless routed through PBK guardrails.

### 12.2 Safety Transparency Pack

Tool:

- `getSafetyTransparencyReport`

Behavior:

- Documents guardrails, approvals, QA, evaluation, and privacy posture.
- References `SAFETY.md`.

### 12.3 Execution Path Search

Tool:

- `planExecutionPathSearch`

Behavior:

- Plans multiple possible response paths before Ava commits.
- Supports backtracking guidance.
- Selects safest/best next move.

### 12.4 Tool Discovery Layer

Tool:

- `discoverExternalTool`

Behavior:

- Maps natural-language needs to the best PBK/MCP/local tool.
- PBK native discovery is live.
- Optional ToolUniverse endpoint can be attached later.

### 12.5 Agent Workflow Memory

Tool:

- `induceWorkflowMemory`

Behavior:

- Induces reusable workflows from successful trajectories.
- Helps create repeatable seller-strategy patterns.

### 12.6 Learned Stopping Agent

Tool:

- `evaluateStoppingAgent`

Behavior:

- Runs parallel strategic guardrail checks.
- Can advise halt, pause, or handoff.
- Blocks known danger patterns like stop requests, legal threats, fragile emotional context, or low-confidence paths.

### 12.7 Constant-Memory Seller State

Tool:

- `compactLongHorizonMemory`

Behavior:

- Compacts long conversations into durable seller state.
- Keeps a small mental model of seller goals, fears, open loops, and next question.
- Native PBK version is active; MEM1 external model slot is optional.

### 12.8 Proactive State Inference

Tool:

- `inferProactiveHumanState`

Behavior:

- Infers stress, distraction, cognitive load, and emotional adjustment from approved text/voice signals.
- Biometric/NeuroSkill external hardware remains opt-in and gated.

### 12.9 Deterministic GUI Automation Planner

Tool:

- `planDeterministicGuiAutomation`

Behavior:

- Plans desktop automation steps symbolically.
- Execution remains approval-gated.
- ClickUI is not directly wired by default; supported path is Desktop Sidecar/AutoGraph-style planning.

### 12.10 L4 Mission Orchestration

Tool:

- `planMasterAgentMission`

Behavior:

- Turns high-level goals into multi-agent mission plans.
- Requires approval gates for provider writes.
- Native PBK mission planning is live; external MasterAgent endpoint is optional.

### 12.11 Unified Provider-Aware Fusion

Tools:

- `runUnifiedAdditiveIntelligence`
- `runProviderAugmentedAdditiveIntelligence`
- `checkResearchAdditiveProviders`

Behavior:

- Runs all ten additives together.
- Produces a single next action.
- Checks optional provider slots.
- Persists provider-check audit rows.
- Keeps all provider writes blocked by default.
- Uses PBK native intelligence when optional providers are not configured.

## 13. Tooling and Extension Systems

### 13.1 Static Tool Router

The bridge exposes tools through `/invoke`. Ava, Rex, Slack routing, dashboard actions, and agent commands all flow through this seam.

Key behavior:

- Tool handlers are centralized.
- Risk metadata defines approval requirements.
- QA and safety validators can wrap execution.
- Tool usage is logged.

### 13.2 Agent Teams / LangGraph-Style Workflows

Tools:

- `runAgentTeam`
- `runTeamWorkflow`

Behavior:

- Supports Idea -> Architect -> Coder -> Reviewer style collaboration.
- Supports team workflow templates.
- Adds multi-step creative/problem-solving workflows without changing the core bridge.

### 13.3 MCP Runtime Registry

Tools:

- `connectMcpServer`
- `listMcpTools`
- `callMcpTool`

Behavior:

- Can connect MCP servers.
- Dynamically registers/calls MCP tools.
- High-risk by default and approval-gated.

### 13.4 Generated Tools

Tools:

- `generateTool`
- `activateGeneratedTool`
- `invokeGeneratedTool`

Behavior:

- AI can draft a new tool body.
- Generated code is syntax-validated.
- Tool is stored pending review.
- Execution is disabled unless explicitly enabled and approved.

### 13.5 Safe CLI Diagnostics

Tool:

- `runCliCommand`

Behavior:

- Allows only read-only diagnostics.
- Blocks destructive commands.
- Restricts working directory to PBK workspace.
- Useful for repo status, logs, rg searches, version checks.

### 13.6 AgentOps

Tool:

- `getAgentOpsMetrics`

Behavior:

- Tracks agent/tool calls, success rates, latency, and last-seen data.
- Stores in `agent_ops`.

## 14. Safety, Compliance, and Approval Controls

### 14.1 Approval-First Operating Mode

Built behaviors:

- Risky actions require approvals.
- Offers, calls, SMS, email sends, DocuSign sends, CRM updates, provider writes, generated tools, MCP calls, and desktop automation remain guarded.
- Approval tasks can be surfaced in the dashboard and Slack.

### 14.2 Safety Validator

Built behaviors:

- MAO/offer guardrails.
- DNC blocking.
- Calling-hours blocking.
- TCPA consent blocking.
- Provider action safety validation.
- Safety audit persistence.

### 14.3 QA Agent

Built behaviors:

- Tool output validation.
- Retry/escalation pattern.
- QA audit persistence.
- Silent failure prevention.

### 14.4 Provider Kill Switch

Built behaviors:

- `pbk_kill_switch`
- Provider kill switch status in runtime state.
- Used to prevent provider writes when a serious issue occurs.

### 14.5 Human Handoff

Tools/behaviors:

- `humanHandoff`
- Low-confidence or high-risk situations can be routed to human review.
- Ava can pause/handoff rather than hallucinating a close.

## 15. Event-Driven Architecture

Built behaviors:

- Event bus status.
- Redis stream/event worker concepts.
- Publish event bus test.
- Dead-letter table.
- Replay/idempotency support.
- Event worker for call embedding and due nurture processing.
- Campaign worker support.

Tables:

- `event_dead_letters`
- `processed_events` pattern in event-worker logic.
- `campaign_worker_runs`

## 16. Observability and Monitoring

Built behaviors:

- `/health` endpoint.
- Hosted smoke test.
- Provider readiness summaries.
- OpenTelemetry/observability module.
- Turn latency tracking.
- Token usage tracking.
- AgentOps metrics.
- Observability alerts table.
- Production pristine/debug checks.
- Live call status diagnostics.
- Call trace diagnostics.
- Weekly health check script.

Key tables:

- `pbk_turn_latency`
- `pbk_observability_alerts`
- `agent_ops`
- `pbk_token_usage`
- `pbk_tool_usage`
- `pbk_qa_audit`
- `pbk_safety_audit`

## 17. Provider and Integration Inventory

### 17.1 Ready/Integrated Provider Classes

Built/integrated:

- Render hosting.
- Netlify hosting.
- Supabase/Postgres.
- Redis.
- Telnyx voice.
- Telnyx SMS.
- Deepgram speech-to-text.
- ElevenLabs TTS.
- DeepSeek LLM lane.
- OpenAI web/search fallback lane.
- Tavily web search.
- Slack approvals/notifications.
- DocuSign contracts.
- Instantly email.
- Google Calendar path.
- n8n workflows.
- Streak/CRM.
- Supabase storage.
- AWS S3 archive.

### 17.2 Optional or Gated Provider Slots

Optional/not fake-live:

- BatchData skip trace requires `PBK_BATCHDATA_API_KEY`.
- External ToolUniverse provider requires `PBK_TOOLUNIVERSE_ENDPOINT`.
- External MEM1 provider/model requires `PBK_MEM1_ENDPOINT` or `PBK_MEM1_MODEL_PATH`.
- External NeuroSkill provider requires `PBK_NEUROSKILL_ENDPOINT`.
- External MasterAgent provider requires `PBK_MASTERAGENT_ENDPOINT`.
- External AWM provider requires `PBK_AWM_ENDPOINT` or model path.
- External EnCompass provider requires `PBK_ENCOMPASS_ENDPOINT`.
- External AutoGraph provider requires `PBK_AUTOGRAPH_ENDPOINT`.
- External ACP provider requires `PBK_ACP_ENDPOINT`.
- Desktop ClickUI is not direct-live; Desktop Sidecar/automation planning is the supported path.

## 18. Database and Schema Inventory

### 18.1 Required Operational Tables Checked in Production

The production schema ensure endpoint currently checks these required tables:

- `pbk_memories`
- `pbk_feedback`
- `pbk_intent_events`
- `pbk_knowledge`
- `pbk_tool_usage`
- `pbk_tasks`
- `pbk_qa_audit`
- `agent_registry`
- `event_dead_letters`
- `pbk_rex_autonomy_runs`
- `pbk_safety_audit`
- `pbk_eval_runs`
- `test_cases`
- `pbk_turn_latency`
- `pbk_observability_alerts`
- `pbk_goal_trajectories`
- `pbk_action_intents`
- `pbk_memory_curation_events`
- `pbk_mission_resilience_eval_runs`
- `agent_ops`
- `generated_tools`
- `agent_teams`
- `lead_profiles`
- `nurture_sequence_templates`
- `nurture_instances`
- `nurture_step_logs`
- `pbk_research_additive_runs`
- `pbk_research_additive_provider_checks`

### 18.2 Additional Runtime Tables Created/Used

Additional tables/surfaces present in schema logic include:

- `coach_memory`
- `skills`
- `skill_usage`
- `ava_learning_sessions`
- `ava_active_memories`
- `inbound_call_routes`
- `agent_tasks`
- `pbk_learning_requests`
- `pbk_repair_items`
- `pbk_offer_overrides`
- `pbk_script_tests`
- `pbk_script_test_events`
- `pbk_outcome_reports`
- `pbk_improvement_suggestions`
- `pbk_knowledge_verifications`
- `pbk_agent_decisions`
- `pbk_call_emotions`
- `pbk_emotional_memory`
- `pbk_emotional_learning_interactions`
- `pbk_emotional_learning_memory`
- `pbk_emotional_policy_experiments`
- `pbk_emotional_policy_outcomes`
- `pbk_prosody_decisions`
- `pbk_prosody_models`
- `pbk_call_analyses`
- `pbk_revenue_actions`
- `pbk_command_center_activations`
- `pbk_bant_sessions`
- `pbk_contract_followups`
- `pbk_call_qa_scores`
- `pbk_skill_outcomes`
- `rex_decisions`
- `campaign_worker_runs`
- `call_embeddings`
- `probe_questions`
- `scripts`
- `activity_log`
- `call_flow`
- `call_flow_edges`
- `pbk_token_usage`

## 19. Dashboard Component Inventory

Core routes:

- `CommandCenter`
- `Inbox`
- `Leads`
- `DealView`
- `AgentFleet`
- `Analytics`
- `MemoryAnalytics`
- `Settings`

Core components:

- `CallFloorPanel`
- `CallModeTab`
- `CallScriptSections`
- `LiveCallInputs`
- `LiveCallWidget`
- `LiveDealTrackerPanel`
- `DealScoring`
- `RepairCalculator`
- `StrategySelector`
- `PathWorkflowPanel`
- `PathDeliverables`
- `UnderwritingControls`
- `DocumentPdfPanel`
- `DocumentTemplates`
- `PDFExporter`
- `CRMFeatures`
- `TopBar`
- `LeftPanel`
- `RightPanel`
- `ShortcutCheatSheet`
- `UiToastHost`

Reusable UI primitives:

- Accordion
- Alert
- Alert dialog
- Avatar
- Badge
- Breadcrumb
- Button
- Calendar
- Card
- Carousel
- Chart
- Checkbox
- Collapsible
- Command
- Context menu
- Dialog
- Drawer
- Dropdown
- Form
- Hover card
- Input
- OTP input
- Label
- Menubar
- Navigation menu
- Pagination
- Popover
- Progress
- Radio group
- Resizable
- Scroll area
- Select
- Separator
- Sheet
- Sidebar
- Skeleton
- Slider
- Sonner/toast
- Switch
- Table
- Tabs
- Textarea
- Toggle
- Tooltip

## 20. Runtime Tool Index

The bridge exposes a large runtime tool set. This section lists the tool handler names as they exist in the bridge.

### 20.1 Lead, Deal, Property, and CRM Tools

- `search_leads`
- `import_leads`
- `analyzeDeal`
- `analyze_deal`
- `getPropertyData`
- `cachePropertyData`
- `scrape_property`
- `recordRepairs`
- `pbkRecordRepairs`
- `simulateDealConfidence`
- `matchBuyers`
- `classifyParticipant`
- `getParticipantProfile`
- `updateCRM`
- `inspectStreakPipeline`
- `getStreakBootstrapPlan`
- `bootstrapStreakPipeline`
- `skipTrace`
- `checkDNC`

### 20.2 Voice, Call, SMS, Email, and Scheduling Tools

- `telnyx_call`
- `telnyx_sms`
- `send_verification_sms`
- `sendColdEmail`
- `scheduleAppointment`
- `handleReplyIntent`
- `pbk_call_operator`
- `humanHandoff`
- `detectYelling`
- `generatePersona`
- `scoreAgentLikability`

### 20.3 Contract and Document Tools

- `prepareContract`
- `prepare_contract`
- `prepare_and_send_contract`
- `sendContract`
- `sendDocuSign`
- `contractLawyerReview`
- `reloadContractTemplates`
- `sendSellerDocs`

### 20.4 Approval, Admin, and Provider Control Tools

- `createApproval`
- `createApprovalTask`
- `requestAdminAction`
- `routeAdminCommand`
- `admin_check_health`
- `admin_restart_openclaw`
- `admin_run_away_worker`
- `admin_update_env_var`
- `pbk_kill_switch`
- `validateProviderActionSafety`

### 20.5 Agent Registry, Teams, and Orchestration Tools

- `getAgentRegistry`
- `refreshAgentRegistry`
- `checkAgentRegistryHealth`
- `findAgentsByCapability`
- `invokeRegisteredAgent`
- `runAgentCommand`
- `runAgentTeam`
- `runTeamWorkflow`
- `runMissionResilienceEval`
- `updateGoalBeliefsBayesian`
- `selectBacktrackingStrategy`
- `reconcileDeclarativeAction`
- `curateEpisodicMemories`
- `createRexDecision`

### 20.6 Ava Intelligence and Conversation Tools

- `activateAvaCallIntelligence`
- `getAvaCallIntelligenceStatus`
- `getAvaConversationIntelligence`
- `pbk_ava_conversation_intelligence`
- `getProsodyAdvice`
- `retrieveClosingIntelligence`
- `pbk_retrieve_closing_intelligence`
- `retrieveSimilarDeals`
- `recallConversationMemory`
- `upsertCallEmbeddingFromTranscript`
- `scoreCallQuality`
- `runAvaCanonicalEvalSuite`
- `avaAskStrategist`
- `askStrategist`
- `avaOverrideOffer`
- `pbk_teach_ava`

### 20.7 Rex, Revenue, and Learning Tools

- `runRexSkillAutopilot`
- `runAutonomousRexGoalDiscovery`
- `handleRexLeadImported`
- `getRevenueEngineStatus`
- `proposeRevenueEngineAction`
- `runCoworkerHeartbeat`
- `runAutoSkillLearner`
- `recordSkillOutcome`
- `selectContextAwareScript`
- `recordContextAwareScriptOutcome`
- `generateSyntheticEdgeCases`
- `trainEmotionWorldModel`

### 20.8 Brain, Memory, Knowledge, and Feedback Tools

- `addPbkMemory`
- `recallPbkMemory`
- `pbk_recall_memory`
- `rememberPersonalFact`
- `remember_personal_fact`
- `getPersonalContext`
- `recordPbkFeedback`
- `recordPbkKnowledge`
- `queryPbkKnowledge`
- `detectPbkIntent`
- `runPbkAgentPipeline`
- `runAvaMemoryLearning`
- `getReadableSummary`
- `getBrainState`
- `getBrainEmailContext`
- `ingestResearchDoc`
- `createBrainBlogPost`
- `trainBrainBlogPost`
- `harvestBrainBlog`
- `recordMarketIntel`
- `pbk_learn`
- `pbk_learn_from_chat`
- `pbk_knowledge_verifier`
- `knowledgeVerifier`

### 20.9 Nurture and Campaign Tools

- `consultNurtureAgent`
- `startNurtureSequence`
- `processDueNurtureSteps`
- `planLeadNurture`

### 20.10 Research Additive / Frontier Intelligence Tools

- `getResearchAdditivesStatus`
- `checkResearchAdditiveProviders`
- `routeAcpMessage`
- `planExecutionPathSearch`
- `induceWorkflowMemory`
- `evaluateStoppingAgent`
- `discoverExternalTool`
- `compactLongHorizonMemory`
- `inferProactiveHumanState`
- `planDeterministicGuiAutomation`
- `planMasterAgentMission`
- `runUnifiedAdditiveIntelligence`
- `runProviderAugmentedAdditiveIntelligence`
- `getSafetyTransparencyReport`

### 20.11 MCP, Generated Tool, CLI, and Observability Tools

- `connectMcpServer`
- `listMcpTools`
- `callMcpTool`
- `generateTool`
- `activateGeneratedTool`
- `invokeGeneratedTool`
- `runCliCommand`
- `getAgentOpsMetrics`
- `getEventBusStatus`
- `getObservabilityStatus`
- `publishEventBusTest`
- `sidecarCommand`

### 20.12 Web, Research, Slack, and Utility Tools

- `webSearch`
- `web_search_plus`
- `openAiWebSearch`
- `launchBrowserResearch`
- `slackNotify`
- `pbk_send_slack_reply`
- `pbk_send_update`
- `runSystemAudit`
- `runYouTubeTrainingPipeline`
- `runYouTubeTrainingEvalSuite`
- `pbk_script_test`
- `scriptTest`
- `pbk_outcome_analyzer`
- `outcomeAnalyzer`
- `pbk_suggestion_engine`
- `suggestionEngine`

## 21. Risk Metadata Summary

Read-only or low-risk examples:

- `analyzeDeal`
- `getAgentRegistry`
- `getAgentOpsMetrics`
- `runAgentTeam`
- `runTeamWorkflow`
- `getResearchAdditivesStatus`
- `planExecutionPathSearch`
- `induceWorkflowMemory`
- `evaluateStoppingAgent`
- `discoverExternalTool`
- `compactLongHorizonMemory`
- `inferProactiveHumanState`
- `planMasterAgentMission`
- `runUnifiedAdditiveIntelligence`
- `runProviderAugmentedAdditiveIntelligence`
- `checkResearchAdditiveProviders`
- `getSafetyTransparencyReport`

Approval-gated or high-risk examples:

- `generateTool`
- `activateGeneratedTool`
- `invokeGeneratedTool`
- `runCliCommand`
- `connectMcpServer`
- `callMcpTool`
- `routeAcpMessage`
- `planDeterministicGuiAutomation`
- `startNurtureSequence`
- `telnyx_call`
- `telnyx_sms`
- `sendColdEmail`
- `sendDocuSign`
- `updateCRM`

## 22. Testing and Verification Inventory

Core build/test commands:

- `npm run build`
- `npm run lint`
- `npm run test:unit`
- `npm run test:bridge`
- `npm run test:hosted`
- `npm run test:founder`

Targeted tests:

- `npm run test:mcp`
- `npm run test:qa-agent`
- `npm run test:agent-registry`
- `npm run test:event-bus`
- `npm run test:rex-autonomy`
- `npm run test:script-rotator`
- `npm run test:safety-validator`
- `npm run test:ava-eval-suite`
- `npm run test:youtube-training`
- `npm run test:mission-resilience`
- `npm run test:desktop-sidecar`
- `npm run test:observability`
- `npm run test:ava-latency-status`
- `npm run test:ava-assistant-chat`
- `npm run test:seven-figure-closer-os`
- `npm run test:tier-additives`
- `npm run test:research-additives`
- `npm run test:chaos`
- `npm run test:coworker-heartbeat`
- `npm run test:slack-mention-router`
- `npm run test:live-data-audit`
- `npm run test:snn`
- `npm run test:x-factor`
- `npm run test:x-dimensions`
- `npm run test:revenue-engine`
- `npm run test:emotion`
- `npm run test:ui-actions`
- `npm run test:intelligence-scorecard`
- `npm run test:tooling`

Debug/ops commands:

- `npm run debug:production`
- `npm run debug:intelligence`
- `npm run debug:telnyx-live`
- `npm run health:weekly`
- `npm run openclaw:heartbeat`
- `npm run openclaw:heartbeat:status`
- `npm run infra:check`
- `npm run doctor:browser-use`
- `npm run property-data:smoke`

## 23. Current Production Reality and Known Gaps

Working and verified:

- Hosted bridge health is `ok`.
- Production revision is v3 provider-augmented intelligence.
- Postgres is the state backend.
- Required database tables exist.
- Native frontier intelligence is live.
- Netlify site responds.
- Hosted smoke passes.
- Slack, Render, Redis, Telnyx, Deepgram, ElevenLabs, DeepSeek, DocuSign, Instantly, Supabase storage, n8n, CRM/Streak, and web-search style provider lanes are represented in hosted checks.

Known optional/not-a-blocker items:

- BatchData skip trace needs its API key if you want that provider live.
- External MEM1, NeuroSkill, MasterAgent, ToolUniverse, AWM, EnCompass, ACP, and AutoGraph endpoints are optional upgrade connectors.
- ClickUI is not directly wired by default; supported desktop path is Desktop Sidecar with approval-gated symbolic planning.
- Revenue engine needs more real leads and live call outcomes to move from readiness to performance proof.
- The strongest next business action remains running real calls and collecting outcomes.

## 24. How PBK Scales the Business

Operator workflow:

1. Import seller leads.
2. Use Command Center/Call Floor to find and prioritize leads.
3. Ava calls or assists with seller conversations.
4. Ava qualifies BANT, detects emotion, locks path, handles objections, and analyzes the deal.
5. Risky actions create approvals instead of silently executing.
6. Rex reviews revenue progress and suggests next actions.
7. Nurture Agent recommends follow-up timing/channel and can queue sequences.
8. Contracts are prepared and sent through approval/DocuSign lanes.
9. Calls, outcomes, emotions, skills, scripts, and tool usage feed learning loops.
10. Analytics and AgentOps reveal what is working and what needs tuning.

Scaling model:

- More leads create more call volume.
- More call outcomes improve memory, script selection, emotion learning, and Rex recommendations.
- More operator approvals allow safe autonomy without losing control.
- Optional providers can be added later without rewriting PBK architecture.

## 25. What Makes PBK Valuable

PBK is valuable because it is not just a chatbot. It is an integrated acquisition operating system:

- It can talk to sellers.
- It can analyze deals.
- It can remember context.
- It can route tools.
- It can generate approvals.
- It can send communications.
- It can prepare contracts.
- It can follow up.
- It can learn from outcomes.
- It can audit itself.
- It can show operators what is happening.
- It can add new provider intelligence without replacing the core.

The business value will be proven by lead volume, live seller calls, conversion rates, closed deals, and repeatable outcomes.

## 26. Recommended Next Operating Checklist

Daily:

- Check `/health`.
- Check approvals.
- Import or refresh leads.
- Run calls.
- Review call recordings/transcripts.
- Approve or reject offers/contracts/follow-ups.
- Review Rex revenue recommendations.
- Review failed tools or provider warnings.

Weekly:

- Review AgentOps and QA audits.
- Review script outcomes.
- Review nurture performance.
- Review emotion/prosody decisions.
- Review call quality scores.
- Run hosted and founder tests.
- Add provider keys only when there is a clear business need.

Monthly:

- Compare deals closed against revenue target.
- Update acquisition scripts from real outcomes.
- Train/export emotion/prosody models when enough call data exists.
- Package safety/guardrail documentation for buyers, investors, or license partners.
- Decide whether to expand internal use, sell SaaS seats, or license the technology.

## 27. Plain-English Bottom Line

PBK Command Center now contains:

- A production web dashboard.
- A production bridge.
- Live voice/SMS/email/contract/provider routes.
- Ava and Rex.
- A multi-agent registry.
- A full safety/QA/approval stack.
- A memory and learning system.
- A nurture and campaign layer.
- A frontier additive intelligence layer.
- Provider-aware upgrade slots.
- Database-backed observability and audit trails.
- A large tool inventory for real operator work.

The remaining growth requirement is operational, not architectural: feed it leads, run live calls, collect outcomes, and let the learning loops build compounding advantage.
