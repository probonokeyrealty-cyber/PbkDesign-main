# Composio agent research foundation

The founder requested Composio around existing agents and continued Claude-assisted UX improvements. They selected **both research and approval-backed follow-up, starting with research**. Their standing direction is to keep building using judgment inside the original design; this first slice introduces advisory research-tool inspection, with production credential activation separately guarded.

## Existing authority

PBK already owns the agent registry, Fleet details, measured readiness, exact-lead context, deal previews, Ava Chat, Brain/Rex and approval dispatch. Extend those surfaces. Rex stays in Brain; Ava supervises; Hermes remains suggest-only. Global tooling/admin controls belong in Settings. No new controller, composer, approval queue, top-level navigation, account-connection flow or execution bypass.

Claude consultation: https://claude.ai/chat/92edc191-fc79-49a5-8230-12c17e43c264 . It recommended an advisory research plan before executing tools. Its suggested new drawers/mobile sheets and approval-payload assumptions are not adopted: reuse existing inline details and existing approval actions instead.

## Approaches and decision

1. Local advisory tool plans only: fastest and requires no Composio backend key, but cannot verify any Composio catalog data.
2. Local plans plus a narrowly scoped Composio catalog adapter: real provider metadata after explicit inspection; needs a backend credential and must label missing configuration honestly.

My choice is approach 2 with the existing local plans retained. Add a compact collapsible Research tools section to the existing selected-agent details. Opening it does nothing externally. **Find research tools** explicitly calls the existing `discoverExternalTool` bridge tool; the response adds a bounded optional Composio catalog result. Preview is read-only. Existing call/message/lead actions keep their current approvals; no new dispatch or outbound execution is included.

## Provider boundary

- Catalog only: one fixed GET to `https://backend.composio.dev/api/v3.1/tools`, with `tool_slugs=COMPOSIO_SEARCH_WEB` and `toolkit_versions[composio_search]=20261119_00`. Require response `items[].slug=COMPOSIO_SEARCH_WEB`, `items[].toolkit.slug=composio_search`, and `items[].version=20261119_00` exactly; available_versions alone is insufficient. No tool execution, proxy, account selection, OAuth, messages, calls, triggers or CRM writes.
- API contract verified in current official docs: https://docs.composio.dev/reference/api-reference/tools/getTools . Project authentication uses the `x-api-key` header. Query accepts `tool_slugs` and `toolkit_versions`.
- Composio CLI is authenticated in the existing developer project. Active playground accounts are not production authorization. A public-only `COMPOSIO_SEARCH_WEB` playground call succeeded; no customer data was submitted.
- Render currently has no Composio key. Require `PBK_COMPOSIO_RESEARCH_ENABLED=true` and secret `COMPOSIO_API_KEY`; default path makes no provider request. Creating/configuring a backend credential is a separate final activation step, not implied by a connected playground account.
- The browser supplies no provider URL, key, account ID, tool slug, version, query or lead data to Composio. The plan request uses a fixed public-research goal. Lead ID is used only for local UI identity isolation.
- Bound the entire request including streamed body completion to 10 seconds and JSON to 256 KiB, no redirects/retries, redact errors. Accept only the fixed slug/toolkit/version; discard raw provider prose, arbitrary URLs and schemas. Missing key returns not_configured; configured key with flag off returns disabled. Neither invents a provider checkedAt.

## Shared response

Optional `composio` on existing discovery response:

`{source:'composio',status,discoveryOnly:true,checkedAt?,tools:[{slug:'COMPOSIO_SEARCH_WEB',name:'Public web research',version:'20261119_00',inputFields:['query'],scope:'public_web',runnable:false}],note}`

Statuses: `matched`, `not_configured`, `disabled`, `authorization_failed`, `rate_limited`, `timed_out`, `unavailable`, `not_found`. No checkedAt is invented when no provider attempt occurred. Notes and labels are server-owned. Matched means catalog metadata was read, not connected-account access, agent readiness or successful execution.

## UX and states

Keep graphite/sky/amber and Fraunces/Geist/JetBrains Mono, existing roster/detail and mobile navigation. Inline disclosures instead of another drawer/sheet. Show advisory matches, provider status, checked time or Never checked, and input field names/scope before any future execution. No Run, Send or Activate control. Calls/messages continue through existing controls.

Local PBK discovery aliases and their risk metadata stay visually separate from the Composio catalog. A local alias may have an existing executable PBK action elsewhere; this inspector executes neither category and never treats catalog metadata as agent readiness.

1440: compact section within current detail column. 390/320: full-width wrapped rows and stacked controls, 44px touch targets, no page overflow. Native disclosures and normal buttons work with keyboard. Announce explicit-request results without stealing focus from a changed agent/lead; late responses cannot populate another selection. Opening, browsing, previewing and switching never invoke a provider or write.

## Acceptance

- Passive route/agent/lead/disclosure selection produces zero new invokes, provider reads or writes.
- One explicit inspection makes at most one catalog request; missing/disabled configuration makes none.
- Exact subject selection remains unchanged. Switching agent/lead clears old plans and ignores late responses.
- Missing/expired/unknown/failed metadata never appears as connected, ready, executed or delivered.
- Unknown slugs/toolkits/versions, oversized bodies, redirects and provider errors cannot become usable tools or expose credentials.
- Existing local discovery, registry readiness, deal preview, call/message approval and saved CRM behavior remain intact.
- Typecheck, lint, build, relevant backend/UI tests, desktop/mobile browser fixtures, independent review and release gates must pass before deployment.
