# PBK Team Launch Assessment

Date: November 15, 2026 (America/Los_Angeles).
Status: researched recommendation, not a launch certification or implemented design.
Follow-up: Approach A safeguards are now implemented locally; see the [launch-safety verification](../superpowers/verification/2026-11-15-pbk-launch-safety.md) for results and release limits. They have not been deployed.
Audience: PBK's own operators first. Paid customer onboarding, billing, and
external-customer tenancy are outside this launch.

## Recommendation

Finish one trustworthy lead-to-follow-up workflow before adding another agent
platform. PBK already has the major components: Ava supervision, Rex research,
Hermes suggestions, Postgres authority, Redis live state, n8n, Slack approvals,
provider dispatch/proof, analyzer, contracts, and the existing dashboard/Electron
surface. The immediate gap is demonstrated safe execution and honest evidence,
not the number of integrations.

The proposed launch flow is:

1. Retrieve a canonical lead and its last completed conversation.
2. Retrieve dated property evidence and operator-reviewed comps.
3. Run the existing calculator; missing inputs remain missing.
4. Prepare an exact proposed action for Slack/operator approval.
5. Execute that unchanged action once through existing dispatch/outbox controls.
6. Reconcile provider acceptance, delivery, failure, and unknown outcomes.
7. Advance follow-up only according to the confirmed outcome.
8. Record an outcome and a scoped, non-sensitive learning summary.

## Current Evidence

These are point-in-time observations, not ongoing monitoring. Runtime responses
were inspected around `2026-11-16T02:01Z` (November 15, 18:01 PST).

| Check | Observed result | What it does not prove |
| --- | --- | --- |
| Render deployment | Live `6b83c24b00ca71969cdaeac32d8651824d5130b3`, deploy `dep-dbt5spu7bikc73fq3m8g` | Every business workflow has completed |
| Netlify staff project | `pbkcenter`, published deployment ready at the same commit; team protection enabled | An authenticated operator has completed every launch task |
| Hosted smoke | Passed; Postgres, Redis event bus, protected state, agent roster, Brain invocation, and PDF generation | Live seller contact or envelope delivery; mutation tests were disabled |
| Core providers | Health reported DeepSeek, voice providers, Slack, DocuSign, Netlify, Render, and OpenClaw ready | Provider health is not delivery proof; hosted OpenClaw status relies on a fresh local heartbeat |
| BatchData | One missing environment setting | Optional capability is not a core launch blocker unless a selected workflow requires it |
| Production maturity | `ready: false`, blocker `stable_agent_fleet_measurement` | A healthy bridge does not equal launch-ready operations |
| Agent measurements | 0/11 met all measurement gates; nine had no qualifying operational success sample | Missing evidence does not prove the implementation is absent |
| Ava latency | Fleet metric p95 71,660 ms from 15 duration samples | This is not time to first token, first audible speech, or a representative production latency benchmark |
| Source labels | Eight services live; one work-queue item dated July 14; campaigns empty | An old task is not necessarily an outage, and an empty campaign list is not a broken campaign engine |

GitHub checks are changing independently of this worktree. The inspected
`6b83c24` [Founder Verify run](https://github.com/probonokeyrealty-cyber/PbkDesign-main/actions/runs/43787369080)
failed the mobile composer source assertion in `scripts/manual-ux-gap-smoke.mjs`.
Its Hosted Founder Smoke and Tooling Verify succeeded. A newer main commit,
`db6a8be7b4533302db478e2d2f9a1d7362ee6e3c`, also finished
[Founder Verify with the same assertion failure](https://github.com/probonokeyrealty-cyber/PbkDesign-main/actions/runs/43790167510)
during this audit; its Hosted Founder Smoke, Tooling Verify and PBK Agent Evals
passed. The source assertion alone does not prove actual mobile overflow; verify
the current layout and test intent before changing either. Do not treat earlier
local Ava-specific passes as a fresh full founder gate pass, or deploy this older
worktree over concurrent work.

## Launch Risks To Resolve

These findings are source inspection plus the read-only checks above. No live
authorization bypass, seller contact, or synthetic lead write was attempted.
Line references below describe the inspected worktree and can move in later commits.

### 1. Missing Underwriting Inputs Can Become Completed Numbers

`scripts/openclaw-local-server.mjs:16589` derives fallback ARV and repairs from an
address hash when supplied/property/comparable values are absent. The analyzer
handler at line 56211 records the run and syncs it to the lead. This is not
verified underwriting evidence, even when an enrichment fallback is labeled.

Required behavior: missing evidence must return an incomplete analysis with
specific missing inputs. Do not save generated ARV, repairs, MAO, or offer values
as completed operational truth. Test missing inputs, zero repairs, cache misses,
stale property evidence, and explicit operator-entered assumptions separately.

### 2. Nurture Can Advance Despite Failure Or Pending Approval

`scripts/nurture-agent.mjs:501` passes SMS content as `text`; the Telnyx handler
at `scripts/openclaw-local-server.mjs:58946` consumes `body` or `message`.
`processNurtureInstance` then advances/completes at line 559 even when the outcome
is failed or queued for approval. The existing smoke mocks unconditional send
success, so it does not cover this payload/outcome contract.

Required behavior: normalize the payload at the existing bridge boundary, retain
the current step on failure/pending/unknown delivery, and reconcile provider
proof before progression according to an explicit channel policy. Retry must use
the original action identity; unknown delivery must not trigger a blind resend.
Prove duplicate callbacks and restart recovery with isolated state.

### 3. General Approval Replay Needs Action-Binding Proof

The operating guard at `scripts/openclaw-local-server.mjs:43425` accepts an
approved ID through `isApprovalApproved` (line 32547), which checks status only.
The inspected direct invoke path then executes the handler. Other paths already
have stronger conversation binding and shared dispatch leases (lines 66853 and
61145). That binding protects SMS/email approval replays with binding metadata;
validation skips approvals without it. Extend those controls instead of creating
another approval system.

Required behavior: bind tool, workspace, lead/recipient, sender, content/terms,
and action identity. Reject a wrong tool, changed recipient/body/amount, expired
approval, and already-consumed action. Repeating the identical action must return
its existing attempt/proof rather than issue a new provider write. Preserve DNC,
consent, quiet-hour, kill-switch, and manual authorization rules.

### 4. Readiness Must Distinguish Packaging From Executed Evidence

`buildAvaFailedCallEvalGateSnapshot` at
`scripts/openclaw-local-server.mjs:11457` constructs scenarios with `passed: true`.
The canary snapshot starts with environment/default metrics, and explicitly
labels the default comparison `same_version_reference`. These are not current
model evaluation results or live shadow-traffic measurements.

The fleet collector at `scripts/agent-fleet-measurement.mjs:118` collects elapsed
durations; `scripts/agent-registry.mjs:624` applies a configurable shared default
budget of 2,500 ms. Split
first-token, full-generation, speech-start, and speech-completion observations.
Segment chat, phone, research, and provider jobs. Keep genuine stalls, failures,
sample count, provenance, and freshness visible; do not just raise all budgets
or exclude slow observations to make readiness green. Controlled drills must
remain labeled and must not masquerade as organic operating evidence.

## Public Open-Source Shortlist

These are public projects, not private repositories or credentials. Sources were
checked on November 15. This is a capability/license screen, not a complete
dependency vulnerability audit. A later implementation must pin versions, review
transitive dependencies and model licenses, and benchmark on PBK fixtures.
The integration recommendations are engineering judgments, not upstream claims.

| Project | PBK use and existing integration point | Decision and constraints |
| --- | --- | --- |
| [fast-check](https://github.com/dubzzz/fast-check), MIT; release page showed v4.10.2 | Generate and shrink approval/retry/callback/cancellation event sequences in the existing Jest tests | Best small new development dependency to evaluate after deterministic regressions; test-only, no new service. Keep the reference model independent of production code. [Model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/), [releases](https://github.com/dubzzz/fast-check/releases) |
| [Promptfoo](https://github.com/promptfoo/promptfoo), MIT; release page showed 0.125.1 | Adversarial and multi-turn Ava/Rex evaluations through a custom adapter to the actual PBK bridge, augmenting `PBK Agent Evals` | Evaluate in isolated fixtures/disposable Neon state, never a seller-writing production target. Assert actual tool/write traces, not only persuasive answer text. Hosted model/grader calls can transmit inputs and cost money. Disable telemetry and remote generation unless explicitly configured; no cloud sharing or raw seller logs. Configs can execute code and are not sandboxed. [Custom adapter](https://www.promptfoo.dev/docs/providers/custom-api/), [telemetry](https://www.promptfoo.dev/docs/configuration/telemetry/), [red-team configuration](https://github.com/promptfoo/promptfoo/blob/main/site/docs/red-team/configuration.md), [security](https://github.com/promptfoo/promptfoo/security), [releases](https://github.com/promptfoo/promptfoo/releases) |
| [OpenTelemetry JS](https://github.com/open-telemetry/opentelemetry-js), Apache-2.0 | Already installed and initialized by `scripts/observability.mjs`; instrument first token, first audio, completion, provider attempts, and correlation IDs there | Extend existing instrumentation before buying/adding another tracing platform. Runtime exporter delivery and retention were not verified by the local smoke. Use allowlisted attributes, no prompts/contact details/tokens. JS traces/metrics are stable; browser instrumentation remains experimental. [Status/docs](https://opentelemetry.io/docs/languages/js/), [license](https://github.com/open-telemetry/opentelemetry-js/blob/main/LICENSE) |
| [pgvector](https://github.com/pgvector/pgvector), PostgreSQL License | Already used by Rex memory with source metadata, model labels, indexes, and Postgres full-text search | Measure existing recall/citations/freshness first. Evaluate hybrid ranking only against a labeled retrieval set. Do not add a second vector database. Queries must respect PBK scope and embedding-model identity; equal vector dimensions do not imply compatible embedding spaces. [Hybrid search](https://github.com/pgvector/pgvector#hybrid-search), [license](https://github.com/pgvector/pgvector/blob/master/LICENSE) |
| [Docling](https://github.com/docling-project/docling), MIT code; individual model licenses vary; release page showed v2.150.1 | Optional structured PDF/OCR ingestion for inspection reports, public-record packets, and approved Brain research through existing ingestion/job paths | Pilot after core workflow fixes. Keep parsing off chat/phone critical paths; retain document/page provenance and human review. Disable remote services, prefetch/pin models, bound file size/pages/time/memory, and isolate untrusted files. No legal conclusions or automatic offer authority. [Offline/limits](https://docling-project.github.io/docling/usage/advanced_options/), [model licensing](https://github.com/docling-project/docling#license), [releases](https://github.com/docling-project/docling/releases) |
| [Presidio](https://github.com/data-privacy-stack/presidio), MIT; release page showed 2.2.366 | Optional additional PII detection before sanitized eval/export or external summary memory, complementing existing PBK redaction | Conditional, not a required new production service. Current canonical project has moved from Microsoft to Data Privacy Stack. Adds Python/NLP operational cost. Detection misses are possible; use data minimization, explicit allowlists, fixture tests, and review. Its REST endpoints have no built-in auth; never expose directly. Do not export raw proprietary business material or seller conversations. [FAQ/security limits](https://github.com/data-privacy-stack/presidio/blob/main/docs/faq.md), [transition](https://github.com/data-privacy-stack/presidio/blob/main/docs/project_transition.md), [releases](https://github.com/data-privacy-stack/presidio/releases) |

No new key is needed merely to evaluate fast-check or the local parsing/redaction
libraries. Model/API evaluations, document models, and hosting have separate
resource costs. Do not create paid services or copy existing Render credentials
into client builds. No speedup, conversion-rate, or hosting-cost claim has been
established for these candidates on PBK.

## Implementation Choices

| Approach | Benefit | Tradeoff |
| --- | --- | --- |
| A. Existing-workflow safety and evidence first (recommended) | Directly addresses the risks above without a new production dependency | Less visible than a new feature, but necessary before scaling outreach |
| B. A first document-intelligence pilot | Adds useful sourced document understanding in the Brain lane | Introduces parsing/model operations while current execution risks remain |
| C. Another general agent/orchestration platform | Could offer a broader framework | Duplicates Ava/Rex/Hermes, n8n, OpenClaw, dispatch and memory; not justified for team launch |

Do not add billing/tenancy, another CRM, another desktop shell, another vector
store, or speculative GPU infrastructure to the internal launch critical path.
Keep DeepSpec disabled until compatible serving support and a PBK benchmark exist.
Do not add optional biometric/personal-assistant lanes.

## Proposed Acceptance Gates For Approach A

1. Missing underwriting inputs cannot create completed operational deal numbers.
2. Modified/consumed approvals cannot cause a provider write; unchanged retries
   reuse durable attempt identity and proof across restart.
3. Pending, failed, unknown, rejected, and delivered follow-up outcomes are
   distinct; no premature progression, duplicate send, or skipped STOP state.
4. Runtime readiness references versioned, timestamped executed evidence. Missing
   or stale evidence is unknown/degraded, never a canned pass.
5. Chat first-token, full reply, and speech timings are separate; cancellation
   never contaminates follow-up history. Full browser playback remains the
   operator's test by explicit request.
6. One controlled, owner-approved test contact completes the lead -> analysis ->
   exact approval -> provider receipt -> follow-up drill. No actual contact is
   attempted until destination, content, channel, and authorization are approved.
7. Fresh full founder/CI, hosted/runtime, restart/replay and applicable 390px/desktop
   checks pass on the intended release commit. Keep authentication unchanged.

Track contacted leads, qualified opportunities, approved offers, delivered
follow-ups, contract outcomes, failure/unknown-delivery rate, approval age,
first-token/first-audio latency, source freshness and cost per completed workflow.
Keep denominators, period and sample counts visible. Do not equate a contract
draft or an LLM response with closed revenue.

## Verification Performed In This Audit

- `npm run test:hosted`: passed with mutations disabled; PDF fixture generation
  and Brain summary invocation included, no outbound contact/envelope send.
- `node scripts/production-maturity-loop-smoke.mjs`: passed (local logic only).
- `node scripts/observability-smoke.mjs`: passed (local instrumentation only).
- Jest fleet measurement/UI suites: 2 suites, 62 tests passed. An initial use of
  the Node test runner was incorrect for these Jest files; rerun used the repo's
  Jest VM-module command.
- Read-only Render/Netlify deployment metadata, health, maturity, circuits,
  archive, agent-health and source-label checks inspected.
- Linear's PBK CC project exists; its project issue query returned no issues.
  No backlog items or project settings were changed.

This task changes this assessment only. No runtime fix, new dependency, key
change, paid service, provider action, deployment, browser playback, or new UI
has been performed. The complete founder gate and customer/seller workflows
have not been rerun or certified by this audit.
