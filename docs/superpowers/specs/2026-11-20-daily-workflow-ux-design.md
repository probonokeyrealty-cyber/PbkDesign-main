# PBK daily workflow UX

The founder chose the daily workflow and approved Today as its first release slice.

## Goal

An operator should be able to open Today and tell what needs attention and where to start. Keep the PBK visual identity, existing desktop sidebar and mobile bottom navigation. Use the same work queue, approval panel and call controls the operator already knows.

Claude recommended a single contextual call action on Today, with a readable status and a large tap target on mobile. The app already has this row. Keep it as the call entry point. The original Claude design also favors a list-first view with clear states and explicitly triggered updates. [Claude UX critique](https://claude.ai/chat/a1c24332-d7a8-45ae-90ac-4ac7c5ee493a) · [Original Claude design](https://claude.ai/chat/1f94828f-e766-4a2c-82c7-82463c84b05e)

## Approaches

1. **Daily workflow, starting with Today (selected).** Clarify the first decision, then carry the same approach into the lead roster, saved evidence and Analyzer in later releases.
2. **Shared navigation first.** Make every destination easier to find before improving the flow. That would leave the immediate question of where to start on Today unresolved.

## First release: one place to start

Use one prominent action near the Today heading. Keep the current call row in that position when it is actionable. Otherwise use the existing review and queue links, in this order:

1. **Open call** for a visible live call, or **Review call** for a completed call that still needs review. Use the established call handler. A reviewed call can still be opened through its existing **View review** control at secondary emphasis.
2. **Review approvals** when the visible Review panel has confirmed pending approvals. Use the existing link into the panel. Leave the decision and submission inside the current approval flow.
3. **Go to work queue** when there is an actionable ranked item. Jump to the Work queue heading. Let the operator choose the record from the existing ordered list.
4. **Browse leads** when the queue is confirmed clear or its data is unavailable. Use the existing full roster link and state why no queue action is shown. During initial loading, show **Loading work queue** while keeping Browse leads available as a secondary link.

Keep Work queue and Review reachable at all times they are available. Each primary action has a short supporting line based on the same data as its destination. Keep connection state and unread information visible without giving them the same emphasis. Use the existing source status for fallback data and avoid presenting a fallback as a confirmed complete queue. Respect hidden widget preferences. A missing approval count or unresolved queue target cannot create a primary action.

### Work queue

Use plain, distinct messages for loading, unavailable, and confirmed empty. Replace the current no-op row with a status message. In a populated queue, show why an item is listed, the relevant lead identity when resolved, and the next action. Keep current ranking, metadata access and exact-ID handoffs. Where a target cannot be resolved, say so and keep it unavailable. Preserve queue scroll and focus when the operator returns from a lead.

On 320px and 390px screens, keep the first action readable with a wrapping layout and a minimum 44px tap target. Use text as well as color for status. Visible focus and section jumps should work with the keyboard. Announce meaningful status changes without moving focus when counts change.

## Scope and later work

Use existing data and runtime paths. Today navigation and queue changes send no ATTOM refresh, Analyze request, lead mutation, or approval submission. Current approval rules and call controls apply. No new searches, provider connections, credentials, or backend changes are needed. Preserve the existing lead, property evidence, Ava, and Analyzer routes.

Later passes improve Leads, the lead workspace and Analyzer so the original lead stays identifiable from queue to saved record, comps, photos, and analysis. Apply the same action hierarchy across the remaining Command Center screens after checking each workflow. The first release is Today only.

## Acceptance checks

- With browser fixtures, verify that a visible active call, completed call awaiting review, confirmed pending approval, actionable queue, loading queue, empty queue, and unavailable queue each present the intended action or status. Include stale or fallback data, a hidden Review widget, and an unresolved lead. Confirm there is one prominent action when one is available.
- Check the original targets for call and approval review. Open a synthetic lead from Today, verify its exact ID, and return to the queue with focus and scroll restored. Assert zero ATTOM refresh or provider-write calls during these paths.
- Run the build, typecheck, Today and mobile checks, and the existing two-lead Ava regression. Check desktop and 390px and 320px widths in a browser using synthetic data. Verify no horizontal overflow, keyboard reachability, and working focus for section jumps. Production publication requires separate release instructions.
