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
