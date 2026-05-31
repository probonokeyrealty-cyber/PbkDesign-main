# Contributing To PBK Command Center

PBK is a production launch system with a React command center, the OpenClaw bridge, event workers, agent tooling, and Supabase/Redis-backed memory. Keep changes small, verified, and easy to roll back.

## Architecture Overview

- `src/` contains the modern React dashboard used by the Netlify app.
- `scripts/openclaw-local-server.mjs` hosts the PBK bridge, tool router, authenticated APIs, and hosted diagnostics.
- `scripts/event-worker.mjs` processes Redis/event-bus work such as call embeddings and nurture steps.
- `scripts/agent-registry.mjs` defines discoverable agents and their capabilities.
- `scripts/nurture-agent.mjs`, `scripts/agent-teams.mjs`, and `scripts/auto-skill-learner.mjs` hold newer modular agent capabilities.
- `supabase/migrations/` contains database migrations for durable production state.

## How To Add A Tool

1. Prefer a focused module under `scripts/tool-handlers/` or another domain folder.
2. Export a pure helper when possible and add a small unit test.
3. Register the tool in `toolHandlers` inside `scripts/openclaw-local-server.mjs`.
4. Add the tool name to `TOOL_NAMES` if it should appear in command-center capability lists.
5. Add risk metadata near `toolMetadata`; provider writes should stay approval-gated.
6. Smoke test through `/invoke` with a safe read-only or dry-run payload.

## How To Run Checks

- `npm run lint` checks the focused modular surface we are actively maintaining.
- `npm run test:unit` runs Jest unit tests.
- `npm run test:agent-registry` verifies agent registry discovery and required agents.
- `npm run test:hosted` runs the hosted bridge smoke suite when credentials are available.
- `npm run test:founder` is the full launch gate and can take significantly longer.

## How To Deploy

1. Commit only intentional files; do not stage generated scratch output unless it is part of the change.
2. Push to GitHub.
3. Netlify deploys the modern dashboard from the frontend build.
4. Render deploys the PBK bridge from the git-backed service.
5. Verify `/health`, `/api/admin/schema/status`, `/api/agents/discover`, and at least one safe `/invoke` call.

## Coding Standards

- Use `apply_patch` or normal editor changes, not broad generated rewrites.
- Keep comments rare and useful; explain non-obvious behavior.
- Avoid mass-formatting legacy files in the same commit as product work.
- Keep provider-write actions behind approval gates.
- Add tests around pure helpers before moving runtime logic.
