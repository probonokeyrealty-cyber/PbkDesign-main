# PBK bidirectional Composio implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in this session. Steps use checkbox syntax for tracking.

**Goal:** Prove restricted read-only Composio access in both directions through PBK's current backend and Command Center.

**Architecture:** A server-managed remote MCP client and a dedicated authenticated, limited MCP endpoint extend the current bridge. Share the restricted PBK server factory with the current stdio wrapper. Existing Settings/legacy tooling summaries show independent connection evidence.

**Tech Stack:** Node 22 ESM, installed MCP SDK, Node test runner, existing React/TypeScript and legacy shell.

**Spec:** `docs/superpowers/specs/2026-11-19-composio-bidirectional-design.md` (approved staging implementation).

## Global constraints

- Default disabled; read-only staging only; production untouched.
- No outreach, tasks, CRM mutations, credentials in client/source/logs, broad proxy tools or approval bypasses.
- Extend the existing PBK runtime/Command Center; retain stdio and current write gates.

## Review focus

- Provider tools renamed or their schemas changed: fail closed before execution.
- Caller supplies nested account/location overrides: reject them; use server-owned exact read arguments.
- Remote failures contain credentials/CRM payloads: expose fixed error codes, never raw exceptions.
- Concurrent/restarted connections: single initialization and fresh evidence; no permanent connected state from configuration alone.
- Remote PBK calls loop back through Composio: inbound tool surface excludes outbound dispatch entirely.

### Task 1: restricted outbound runtime

**Files:** create `scripts/lib/composio-connection.mjs`, `scripts/composio-connection.node-test.mjs`; modify bridge MCP handlers and agent command dispatch.

**Interfaces:** `createComposioConnection({env, connect?, now?})` returns `status()`, `read({operation, agentId})`, `close()`. Server configuration binds HTTPS URL, credential reference, immutable operation/tool/arguments/schema policy. Results are selected by explicit configured JSON paths, not forwarded as full MCP envelopes.

- [ ] Write failing tests for disabled/missing config, destination restrictions, exact allowlist/argument binding, schema mismatch, nested override/write denial, concurrent calls, reconnect timeout and safe status/errors.
- [ ] Run tests and observe expected missing module failure.
- [ ] Implement SDK Streamable HTTP adapter, fixed error codes, bounded timeout/backoff and safe evidence.
- [ ] Wire explicit agent-command tool-first Composio reads to Ava/Rex only, with no generic tool inference or provider mutations.
- [ ] Run focused tests and bridge regression.

### Task 2: restricted inbound endpoint

**Files:** create `scripts/lib/pbk-readonly-mcp.mjs`, its declaration and focused tests; refactor `mcp-server/src/index.ts`/factory; integrate route into bridge before general bearer gate.

**Interfaces:** `createPbkReadOnlyMcpServer({readStatus})` registers only health, registry summary and integration readiness. `createPbkReadOnlyMcpEndpoint({env,readStatus,now?})` returns `handle(req,res)` and sanitized `status()`.

- [ ] Write failing real HTTP/client tests for dedicated auth, staging gating, strict Host/Origin, limits, invalid inputs and forbidden tool calls.
- [ ] Implement stateless JSON Streamable HTTP with bounded body/rate/timeouts; project-specific inbound key distinct from bridge/outbound keys.
- [ ] Reuse restricted factory in the stdio wrapper via an explicit read-only profile; retain existing default tool set.
- [ ] Verify only selected metadata leaves the endpoint, connection evidence follows successful tool reads, and no CRM/state envelope leaks.

### Task 3: Command Center status and verification

**Files:** modify bridge tooling status, `runtimeBridge.ts`, Settings and legacy tooling summary; add focused UI/runtime tests; create operations runbook.

- [ ] Add failing assertions for separate inbound/outbound states, disconnected default and sanitized reasons.
- [ ] Implement compact existing Settings/legacy status display and default-off configuration documentation.
- [ ] Run focused tests, `npm run test:mcp`, `npm run test:bridge`, frontend build and local signed-in desktop/mobile checks where available.
- [ ] Inspect staging resource/credential availability without exposing secret values. Deploy/enable only a proven separate staging profile; never flip production.
- [ ] If credentials or isolated staging hosting are absent, leave disabled and report the exact remaining prerequisite. Do not claim mocked proof is hosted proof.
- [ ] Request whole-change review, resolve findings, record evidence and remaining limitations.

No unrelated dirty changes will be staged/reset or included in commits. Review authorization already covers implementing this approved design inline; no scope expansion is proposed by this plan.
