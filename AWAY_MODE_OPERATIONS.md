# PBK Away Mode Operations

This runbook turns PBK into a low-cost unattended system while keeping live provider and billing changes human-owned.

## What ships in this repo

- GitHub issue template for agent work packets
- GitHub Actions for founder verification, hosted smoke, planner, and auto-merge
- GitHub label sync script
- Local unattended worker script powered by `openclaw agent --local`
- Hosted smoke harness for the live bridge

## Required GitHub secrets

Set these in `probonokeyrealty-cyber/PbkDesign-main`:

| Secret | Purpose |
| --- | --- |
| `GOOGLE_API_KEY` | Planner model (`google/gemini-2.5-flash`) |
| `PBK_SLACK_WEBHOOK_URL` | Daily planner digest / alerts |
| `PBK_BRIDGE_API_KEY` | Hosted founder smoke auth |
| `PBK_HOSTED_BRIDGE_URL` | Optional override for hosted smoke; defaults to Render bridge URL |

## Required local desktop setup

The unattended builder runs on your machine and needs:

| Setting | Purpose |
| --- | --- |
| `PBK_GITHUB_TOKEN` or `gh auth login` | GitHub API + PR creation |
| OpenClaw local model auth | Lets `openclaw agent --local` edit the repo |
| A clean dedicated repo clone | Prevents the worker from colliding with your active workspace |

Recommended dedicated clone path:

```powershell
git clone https://github.com/probonokeyrealty-cyber/PbkDesign-main.git C:\Users\Dell\pbk-agent-runner
```

Then point the scheduled worker at that clone instead of your live workspace.

## One-time workflow bootstrap

After these files are merged:

1. Run the `Agent Planner` workflow once with `workflow_dispatch`.
2. Confirm the seven `agent/*` labels exist.
3. Create at least one issue from the `Agent Work Packet` template.
4. Label it with exactly one category label plus `agent/ready`.

## Local worker registration

Review the worker script first:

- `scripts/pbk-agent-worker.ps1`
- `scripts/register-pbk-agent-worker.ps1`

Then register the scheduled task:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-pbk-agent-worker.ps1 -RepoPath C:\Users\Dell\pbk-agent-runner
```

The task runs every 15 minutes, claims one `agent/ready` issue, creates a branch, uses the local OpenClaw agent to make the change, runs `npm run test:founder`, pushes the branch, and opens a PR.

## Safety rules

The unattended system is allowed to:

- edit code
- run local founder checks
- open PRs
- auto-merge PRs only when labeled `agent/automerge`

The unattended system must not:

- change secrets or env vars
- modify Render or Netlify dashboard settings
- buy paid resources
- rotate tokens
- finish provider onboarding steps

Use `agent/human-required` for any of those.

## Hosted founder smoke

Use:

```powershell
npm run test:hosted
```

Optional deeper hosted replay verification:

```powershell
$env:PBK_HOSTED_SMOKE_MUTATE='true'
npm run test:hosted
```

The default hosted smoke is read-mostly. Mutation mode intentionally creates replay-safe lead and approval events in the live bridge.

## Netlify repo drift cleanup

PBK should end on one source repo:

- Render: `probonokeyrealty-cyber/PbkDesign-main`
- Netlify: `probonokeyrealty-cyber/PbkDesign-main`

Manual cleanup target:

1. In Netlify, point `pbkcommandcenter` at `probonokeyrealty-cyber/PbkDesign-main`
2. Use the repo-root `netlify.toml` in this repo
3. Retire the mirror repo after one successful production rebuild

Until that switch is complete, treat any mirror repo as transitional only.
