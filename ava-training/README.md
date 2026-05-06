# Ava Training Loop

PBK's Ava training loop is a launch-safe self-improvement system. It improves memory, feedback quality, and future fine-tuning readiness without changing provider execution.

## What Runs Automatically

- GitHub Actions runs `npm run ava:training:loop` every 2 hours.
- The worker calls the hosted bridge learning endpoint.
- Ava extracts lessons from approved PBK activity and active memory.
- Provider writes remain off unless you explicitly change campaign/provider settings.

## What This Adds

- `npm run ava:training:export` builds `.pbk-training/ava-training-data.jsonl` from approved `pbk_feedback`.
- `program.md` defines the PBK-approved evaluation objective.
- `pbk_skills/` stores seed behavioral skills that Ava/Rex can use as playbooks.

## What This Does Not Do

- It does not install unverified runtime plugins.
- It does not fine-tune a model automatically.
- It does not change Render environment variables.
- It does not send emails, SMS, calls, or contracts.
- It does not disable approval mode.

## Why Not Direct AutoResearch or MetaClaw Install

The high-level idea is right: continuous learning should use approved PBK feedback and memory. The exact tools in the pasted guide are not safe as direct production installs today:

- AutoResearch is a research loop, not a drop-in OpenAI fine-tuning cron for this bridge.
- `@openclaw/metaclaw` is not a verified OpenClaw real-time skill-learning plugin in this repo.

PBK therefore keeps the stable contract: local/exported training data, MCP memory tools, approval-gated actions, and manual model promotion.

## Local Commands

```bash
npm run ava:training:loop
npm run ava:training:export
```

The export output is ignored by git because it may contain seller transcript snippets.
