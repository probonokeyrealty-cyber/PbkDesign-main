# Composio Agent Research Implementation Plan

> REQUIRED WORKFLOW: Use `superpowers:subagent-driven-development` for focused implementation tasks, task review and final whole-branch review.

**Goal:** Add explicit advisory research-tool inspection around existing PBK agents, with bounded Composio catalog metadata and original-design UX.

**Architecture:** Existing `discoverExternalTool` retains local behavior; an explicit includeComposio request adds a lazy fixed catalog adapter. An inline Fleet details component consumes the shared response and never executes tools. Existing provider/CRM/approval seams remain authoritative.

**Tech Stack:** Existing Node fetch, React/TypeScript, PBK CSS and Node/isolated browser tests. No dependency changes required.

**Spec:** `docs/superpowers/specs/2026-11-19-composio-agent-research-design.md`

## Global constraints

Follow the spec exactly: fixed catalog-only tool/version, secret server authentication, feature flag off by default, no automatic calls, no customer data or connected-account selection, no execution or outbound control. Keep original shell and Rex/Brain/Ava roles. Missing configuration must be useful and honest, not a fake live integration.

## Review focus

Untrusted catalog data, missing keys, errors and body limits; synchronous local discovery callers; async agent/lead changes; duplicate requests; discovery being misrepresented as readiness; provider/admin writes bypassing existing approvals.

### Task 1: Lazy bounded catalog adapter

- [ ] Create `scripts/composio-research-discovery.mjs` exporting `createComposioResearchDiscovery({env=process.env,fetchImpl=globalThis.fetch,now=()=>new Date().toISOString()}={})`, returning an async zero-argument reader with the exact shared response in the spec.
- [ ] TDD in `scripts/composio-research-discovery.node-test.mjs`: disabled/missing-key zero fetch; exact fixed request; strict projection; timeout, redirect, HTTP failure redaction and pre-parse body bounds. No live credential usage or source calls.

### Task 2: Original-design inline research plans

- [ ] Create `src/app/components/agents/AgentResearchTools.tsx` and focused CSS. Props `{agentId:string,agentName:string,leadId?:string}`; invoke existing `invokeRuntimeTool('discoverExternalTool',{query:'public web research',includeComposio:true})` only on explicit Find research tools.
- [ ] Integrate the component in `src/app/routes/AgentFleet.tsx` below existing capabilities, keyed by both active agent ID and canonical selected lead identity; preserve current controls/navigation/readiness. No new route, drawer or composer. Shared backend DTO comes from the spec; add frontend types locally without editing runtimeBridge.ts.
- [ ] Add focused tests for passive controls, truthful status/preview, disabled run behavior (no such control), and late-response selection isolation. Do not alter backend/bridge files.

### Task 3: Bridge integration and review

- [ ] Coordinator wires the adapter into existing discovery handler only when includeComposio is strictly true; await before existing audit. Keep synchronous local discovery core and existing callers unchanged.
- [ ] Add Docker copy and required bridge source fingerprint updates through existing proof tooling. Wire focused tests into existing release gate without changing exact-script contracts.
- [ ] Run backend/UI/type/lint/build, full UI release and isolated Fleet desktop/WebKit390/Chromium320 proofs; independent task and whole-branch review.
- [ ] Prepare a concrete production credential/activation step if needed; never copy workstation auth or treat playground credentials as production authorization. Use approved task-branch/PR/deployment flow after gates.
