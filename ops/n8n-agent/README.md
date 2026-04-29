# PBK n8n Agent Notes

PBK already uses `n8n-lite/` for workflow definitions. This folder documents the optional AI-assisted layer we discussed.

Current repo support:

- `n8n-lite/tooling-health-check.json` for bridge/runtime monitoring
- bridge endpoints for approvals, quotas, seller docs, admin tasks, and webhooks

Recommended next step if you install a dedicated n8n-agent later:

1. Import `tooling-health-check.json`
2. Point it at the hosted bridge
3. Let the AI layer suggest workflow edits, but keep imports/replacements manual until trust is established
