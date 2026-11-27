# Workflow-First Wording And Polish

## Approved Direction
The founder approved a local workflow-first pass through Today, Lead Workspace,
Analyzer, Approvals and Inbox. Extend PBK's existing design and controls; do not
replace the shell or create another dashboard. Native implementation in this
session is the execution choice for this closely related copy/presentation pass.

## Scope
- Extend `operatorCopy.ts` for plain-English queue and approval states.
- Use explicit labels for existing summary, save, lead-edit and conversation actions.
- Name the selected approval decision on its final confirmation button.
- Keep decision acknowledgement distinct from delivery/completion evidence.
- Improve wrapping, keyboard focus and 44px touch targets within existing surfaces.

## Approaches
Workflow-first was selected over copy-only everywhere (less workflow improvement)
and an all-page interaction refresh (larger behavioral and responsive blast radius).
Remaining pages can adopt the same vocabulary after this first flow is verified.

## Constraints
Preserve PBK fonts, palette, navigation, routes, draft keys, notes, saved comps,
lead data, consent/DNC checks, approval preflight and explicit write handlers.
No provider/admin handler changes, autosaving lead edits, production business
requests, deployment, push, calls, or outbound messages. Tests use local isolated
sample contexts and deny external/provider traffic and business writes.

## Verification
Test copy semantics first, then real desktop and mobile browser interactions,
including approval cancellation, draft reload, unsaved edit cancellation and
long-label containment. Build and typecheck; retain screenshots and request counts.
