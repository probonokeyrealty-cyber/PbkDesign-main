# PBK wholesale readiness — local review package

## What is built

An executable, read-only first slice for HighLevel lead completeness, native property ownership, and dated next steps. It produces six internal review queues using existing records and fields:

| Queue | Meaning |
| --- | --- |
| Research gaps | Missing/invalid minimum intake facts |
| Owner needed | Native opportunity owner missing |
| Next step needed | Missing, invalid, or completed next step needing review |
| Dated step overdue | The saved calendar deadline/explicit timestamp is overdue |
| Handoff exceptions | Task-reference gaps, ownership/date conflicts, or incomplete task evidence |
| Potential duplicate review | Different native property IDs share a full address or county/APN |

**This is not installed in live HighLevel.** A read-only check of the account switcher's ALL ACCOUNTS list shows only the live PBK business subaccount; no separate sandbox is available in this session. The founder required production untouched, so no new live views, fields, workflows, tags, owners, tasks, or enrollments were saved. The package contains no activation or provider-write command. It is not a replacement portal or a new command surface.

## Run the review

From this checkout:

```powershell
node scripts/preview-ghl-readiness.mjs --input scripts/fixtures/ghl-readiness.json --output-dir .pbk-local/ghl-readiness-preview/synthetic --now 2026-11-17T02:00:00Z
node --test scripts/ghl-readiness.node-test.mjs scripts/lead-intelligence.node-test.mjs
```

The fixed date is a reproducible test clock, not the current runtime time. For a new snapshot, pass its actual review instant with an explicit timezone. Output reports are deterministic for an identical input and clock. Source files are never edited. Private reports are restricted to this checkout's ignored `.pbk-local` directory; no public site/build directory is allowed.

## Snapshot contract

The evaluator consumes a canonical review snapshot, not an arbitrary HighLevel export. It needs:

- `contacts`: existing `id`, name or first/last name, phone/email if captured, tags, native DND information, and assignedTo if captured. DND unknown is not cleared.
- `opportunities`: existing `id`, `contactId`, `name`, `status`, native `assignedTo`, and customFields containing `id`/`fieldValue` pairs.
- `fieldDefinitions`: each custom field's verified `id`, exact `name`, and `model: opportunity`. Names resolve once to definition IDs; duplicate/missing definitions stop evaluation. Do not invent production field IDs.
- `tasks`: existing `id`, contactId, opportunityId when explicitly available, completed boolean or known status, assignedTo, and dueDate. A contact-level task is associated with a property only by that property's saved task ID; unrelated contact tasks do not count.
- `tasksComplete`: explicitly true only after every page of the relevant task snapshot has been collected. Otherwise missing tasks remain unknown.

Contact and opportunity IDs are never generated or upserted. Identical repeated IDs collapse in the preview; conflicting records sharing an ID stop it. Different property IDs with matching county/APN or a full address go into review, not an automatic merge. This detects only those identity signals, not every possible duplicate in the CRM.

Minimum intake coverage is **11 checks**, not the full 44-fact PropStream schema or verified lead qualification. It includes nine existing native property/research fields, contact name, and at least one captured contact method. Unknown values stay missing; no bedrooms/bathrooms are demanded for land. Captured contact information is not proof of validity or consent.

## Existing fields reused

`config/ghl/wholesale-readiness.v1.json` lists the exact native field names. Accountability uses:

- Native opportunity `assignedTo` for one accountable owner per property.
- PBK Handoff Summary & Next Step.
- PBK Next Step Due Date.
- PBK Next Step Status.
- PBK Next Step Task ID.

The free-text Handoff Accepted By field and contact owner are useful context but cannot fill the native property owner. A mismatch is reviewable and never silently overwritten. Completed tasks stay history; a finished next step is flagged for deciding the next action, never automatically recreated.

Due-date-only values are compared against the Los Angeles calendar day. They are not overdue earlier on their due day. Instant timestamps require an explicit offset; unparseable or impossible dates are review gaps. No deadline is extracted from prose or manufactured from a task title.

Recognized active next-step statuses are Open, Pending, Not Started, Scheduled, In Progress, and Overdue (case/space variants accepted). Complete/Completed, Done, and Cancelled/Canceled are finished states. Other populated statuses are explicit review gaps until a native mapping is verified. Malformed task links/completion flags stop the snapshot; contradictory task status is a review exception. One contact-level task cannot satisfy two active properties' next-step references.

## Native HighLevel worklist recipes for a future isolated install

These are configuration recipes, **not importable HighLevel workflow JSON**. The evaluator is the exact reference predicate. The native UI's support for equivalent compound filters must be checked in an isolated sandbox before claiming equivalent views exist.

1. Every sales-operation queue first excludes QA/test/sandbox identifiers from names, tags, source, and explicit QA flags, then excludes non-open opportunities. Use reviewed native QA markers for saved filters; never rely solely on a workflow/view name containing STAGING.
2. Quarantine potential duplicates before ordinary operational queues. Human review is required; do not merge contacts or properties automatically.
3. Research gaps: any minimum check missing/invalid. Keep source estimates separate from reviewed ARV/MAO and original/effective construction year.
4. Owner needed: native opportunity owner missing. Do not infer an assignee from old notes, first/last names, or contact owner.
5. Next step needed: summary, due date, or status absent/invalid, or the previous step completed. Review before deciding a replacement; do not enroll or add tasks.
6. Dated step overdue: an open property's saved next-step date is overdue at its actual precision. Display owner and existing task reference.
7. Handoff exceptions: incomplete task snapshot, missing/current-task reference, multiple current tasks, or owner/date/link disagreement. Preserve all history and require reconciliation first.

DND records may be reviewed internally for data quality. None of these queues are outreach lists. The output always says `outreachAllowed: false`, with `writes: []`. A future provider write must still use the existing PBK approval bridge; this code grants no authority.

## Evidence and deployment status

- Browser read-only check: existing QA contact still shows DND All Channels checked, one linked opportunity, and Unassigned owner. Its property task tab shows No tasks yet. Native handoff/accountability field names were confirmed in the existing property modal.
- Retained QA reconstruction: one existing QA contact/property pair evaluated, QA excluded from all six operational queues, no provider writes. It combines retained verified UI values with the current safety checks; it is **not a fresh full provider API snapshot**. Local pairing IDs label its copied field-name/value evidence and must never be used for a native deployment. Eight of nine minimum property facts were present in retained proof; the unavailable research-as-of value stays unknown.
- Synthetic six-property run: 1 research gap, 1 owner gap, 1 missing next step, 1 overdue step, 1 handoff exception, 2 potential duplicate properties, and 1 QA exclusion. A property may appear in several review queues, so counts are not unique lead totals.
- Initial evaluator tests: 16/16. CLI tests: 3/3. Existing lead-intelligence regressions: 15/15. Later final proof and review results will be recorded below.
- No UI changes, frontend deployment, native CRM activation, contacts/properties/tasks created, outreach, or production data changes.
- Gradients, CRM transport, Calendly, gold badges, and guide integration configuration were not modified. Their end-to-end behavior was not retested by this local evaluation.

## Next installation dependency

An isolated HighLevel sandbox/subaccount or explicit permission to change named draft-only configuration in the live location is required before a native install. The package is ready for review and further testing without that dependency; it does not pretend an active HighLevel system was deployed.

The founder has been asked which sandbox/test subaccount should receive the draft. No request to override the production boundary was made.

## Final verification

Fresh independent review found five important issues: mixed date precision, shared task references, malformed task linkage, unrecognized/contradictory status, and linked private output roots. Each was reproduced before correction, then covered by passing regression tests. The DND unknown-channel case was also corrected; the overstated link-test title was narrowed and directory-junction behavior is exercised directly.

Final targeted suite: **41/41 passed** (26 readiness/CLI tests plus 15 existing intelligence tests), Node 24.14.1. The project's declared runtime is Node 22; no Node 22 execution is claimed. Both JavaScript modules also pass `node --check`.

The six-property synthetic and one-property retained QA previews were rerun after the fixes. QA proof: one property, one QA exclusion, zero operational queue entries, DND on, outreachAllowed false, zero write commands. Repeated identical runs preserve source input and produce byte-identical JSON.

No frontend files were changed in this slice, so no desktop/mobile UI or hosted deployment validation is claimed. There is no default `npm test` script in this checkout. Provider-facing suites were not run because this slice has no provider integration and the founder prohibited production effects.

Rulings: use the existing isolated worktree; keep this first slice local because no HighLevel sandbox is verified; use 11 explicitly labeled minimum intake checks rather than implying all 44 source facts are required for every property type. The tradeoff is that native views/automation remain uninstalled and full source-field coverage is not a qualification score.

The review intentionally excluded live native filter equivalence, unchanged UI/hosted runtime, and identity matching beyond the documented signals. Those remain explicit limits, not passing checks. No review findings are deferred within this slice.
