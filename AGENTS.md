# PBK Agent Operating Guide

Follow `CLAUDE.md` and `DESIGN.md` before making product or UI changes.

Core rules:

- Preserve the modern PBK Command Center UI/UX.
- Keep Rex inside the Brain lane.
- Keep provider/admin writes approval-backed.
- Do not hardcode secrets or key-shaped values.
- Prefer existing bridge-backed runtime seams over duplicate client logic.
- Verify UI changes with build, hosted/runtime smoke, BrowserOS when relevant, and mobile overflow checks.

