# PBK Agent Operating Guide

Follow `CLAUDE.md`, `DESIGN.md`, and `PBK_DESIGN.md` before making product or UI changes.

Core rules:

- Preserve the modern PBK Command Center UI/UX.
- Keep Rex inside the Brain lane.
- Keep provider/admin writes approval-backed.
- Do not hardcode secrets or key-shaped values.
- Keep Supermemory/external memory scoped only to PBK Wholesale Paradise.
- Store only anonymized memory summaries, patterns, and non-sensitive runbook lessons unless a stricter data policy is added.
- Prefer existing bridge-backed runtime seams over duplicate client logic.
- Verify UI changes with build, hosted/runtime smoke, BrowserOS when relevant, and mobile overflow checks.
- Ava's human-communication intelligence must stay truthful, consent-aware, and approval-gated: disclose AI identity when asked, use humor only when emotionally safe, avoid jokes around grief/anger/fear/scam concerns, and log useful communication lessons through PBK memory/feedback instead of hardcoding manipulative scripts.
- Ava may use `pbk_send_update` for operator check-ins after campaign runs, every 10 processed leads, urgent runtime issues, or growing approval queues; these updates are informational and must not bypass approval gates or provider-write controls.
