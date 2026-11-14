# Lead Evidence Guidance

REQUIRED WORKFLOW: Use `superpowers:subagent-driven-development` with one focused implementation pass per task and review between tasks.

Continue the selected Decision Rail design with actionable, read-only guidance on Lead Workspace.

- Identify missing address components beside Property facts. Complete address opens the existing editor; complete addresses offer Review property record, which changes tabs and moves keyboard focus but does not run a lookup.
- Preserve manual facts, editor save handlers, ARV, comps, Zillow navigation and separate MLS media.
- Fix the contactability display's substring matching: only the canonical saved `yes` value gets positive consent styling. Negative and ambiguous text never implies clearance. DNC displays recognize explicit blocked/clear records; unknown values require review.
- Label records as records, not permission to call. No changes to dispatch, eligibility policy, approval or contact slots.
- Test incomplete ZIP, Cancel, record focus, negative/ambiguous consent, ambiguous DNC, desktop/mobile/WebKit layout and zero writes/provider requests using synthetic leads.
- Local only. No deployment or live lead changes.
