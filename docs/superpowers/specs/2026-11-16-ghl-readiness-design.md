# HighLevel wholesale readiness — first slice

Founder direction: choose the approach and execute; start with completeness, ownership, and dated next steps. Preserve DND, exclude QA, create no duplicates/outreach, and leave production untouched.

## Chosen implementation

Build a local, executable review package for existing HighLevel records. Reuse native opportunity owner and PBK handoff/research fields. Do not save configuration into the live account, activate automation, or introduce another operator UI. This is the smallest useful implementation consistent with the production boundary; no isolated HighLevel sandbox has been verified.

The alternative of immediately adding saved views/workflows in the connected live location would change production. Replacing the existing pipelines or PBK Command Center would conflict with the operating guide. Both are excluded.

## Behavior

- Accept an explicit JSON snapshot of contacts, opportunities, tasks, and custom-field definitions. Require existing IDs. Resolve custom fields by their field definition IDs, never fuzzy labels or guessed IDs.
- Measure 11 minimum intake checks: nine native property/research facts plus contact name and one available contact method. Show each missing/invalid fact; this is coverage, not verification, deal qualification, or permission to contact. Do not require bedrooms or bathrooms for land.
- Use opportunity assignedTo as the accountable owner. Contact ownership or the free-text Handoff Accepted By field cannot substitute for it. Flag disagreement without changing either record.
- Reuse PBK Handoff Summary & Next Step, PBK Next Step Due Date, PBK Next Step Status, and PBK Next Step Task ID. Flag missing/invalid dates, missing task references, mismatched ownership, and multiple current tasks. Never create a task, erase history, or invent a due date.
- Date-only deadlines compare against the current calendar date in America/Los_Angeles. Timestamps require an explicit offset. A task snapshot must be explicitly complete before absence can be asserted; otherwise show unknown.
- QA/test identification checks contact and opportunity names, tags, and source. Exclude QA and non-open opportunities from every operational queue and its counts. Preserve a separate diagnostic result for inspection. QA is never promoted by completeness or urgency.
- DND is a restriction, not a completeness score. All output always sets outreachAllowed false and contains no write operations. DND contacts may appear only in internal data-review queues; they are not outreach candidates.
- Repeated identical IDs collapse in the preview. Conflicting repeated IDs fail validation. Different IDs that share county/APN or a full property address are potential duplicates and blocked from operational queues pending review. Never merge or create records.

## Boundaries and output

Produce review JSON and Markdown using the existing local operations tooling. The program has no provider client, network requests, write-mode flag, or deployment path. Source snapshots and reports containing private data remain in the ignored .pbk-local directory. Public fixtures are synthetic.

Native HighLevel view recipes are documented alongside the evaluator, clearly marked as recipes rather than importable HighLevel workflow JSON. A later staging install must re-resolve field IDs, validate enrollment isolation, and compare rules against the evaluator before any activation.

## Verification

Node tests cover QA/DND, 11-check completeness, zeros, unknowns, dates/timezones, per-property owner, current-task references, history, incomplete snapshots, duplicate contacts/properties, immutable input, CLI side effects, and deterministic repeated runs. Run the evaluator on the retained existing QA evidence without any provider writes. No UI change or deployment is part of this slice.
