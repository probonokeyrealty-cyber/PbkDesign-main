# Skill Studio Version-Change Notice Design

Status: browser-free reducer/unmounted-component phase accepted. The founder
subsequently approved local integration and isolated synthetic Chromium/WebKit
tests, mobile checks and independent review. Production access, push, PR changes,
merge, deployment, seller contact and delivery retries remain unauthorized.
Source baseline: `8bb21d63ba758cd4f688d8f161c35a674a57a31c` (draft PR #41).

## Intent

Make automatic changes of the skill version under review explicit, without
changing which version Skill Studio selects or how any approval works.

Source observation: `src/app/routes/SkillStudio.tsx:1187` retains the current
version if returned by an owned, validated repository read; otherwise it selects
the first returned version or clears selection. No replacement notice exists.
The possible interruption to an operator's review is inferred from this code,
not measured user behavior. Existing filter labels and next-step fallback copy
already address Claude's other suggestions and are not part of this change.

## Approaches

- **Announce replacement (selected):** preserve automatic selection and add a
  distinct status line. Small and additive, but still requires the operator to
  notice that review context changed.
- **Require re-selection (not selected):** clear review context until the operator
  chooses another version. More explicit, but changes selection behavior and
  adds an interaction whenever a search or lifecycle read excludes the version.

The advisory [Claude review](https://claude.ai/chat/339fbb34-27f0-4e71-8dfb-2f8068e644cd)
recommended the first approach after source corrections. Neither approach can
guarantee operator understanding; existing target binding is not proof of intent.

## Behavior

- Only an owned, validated, successful repository/status commit can create a
  notice. Compare against the latest selected ID at commit time, not the ID
  captured when the request started.
- If a nonempty selected ID is absent and a replacement exists, display:
  `Version {oldId} is not in the current results. Showing {newId}.`
- If that successful read is empty, display:
  `Version {oldId} is not in the current results.` Keep the existing empty view;
  do not invent a replacement or claim the old version was deleted.
- Initial loading with no selected ID produces no change notice. An owned
  successful read that preserves selection clears any previous change notice,
  preventing outdated claims about membership in the current results.
- Manual version selection and the existing mobile Repository return clear the
  notice. Local paging and agent/risk/performance filters do not create one.
- Pending, stale, failed or invalid reads do not create, overwrite or clear it.
  Existing retained-view/error feedback continues to describe those states.
- A same-ID hash or lifecycle change does not become a version-ID replacement
  notice. Existing confirmation invalidation still applies unchanged.

## Presentation And Safety

Use one separate, unframed status line near the existing page feedback, before
the training queue/workspace, so it is available in both mobile modes and when
results are empty. Use polite, atomic live-region semantics; do not announce the
same transition repeatedly, move focus, scroll, open a dialog or add an action.
Render exact IDs as text with wrapping at 320px, 390px and desktop widths.

Keep its state separate from the current `notice`/`error` action-feedback slot.
Copy success, approval outcomes and errors must not overwrite the context notice,
and the notice must not hide or dismiss those outcomes. Preserve PBK tokens and
typography; add no panel, new palette or replacement layout.

Selection and notice must describe one committed result, including if the user
selects another version while a read is pending. Avoid side effects inside React
state updaters or render paths that could duplicate announcements in Strict Mode.
The builder may choose a small transition helper or local state representation;
no new backend, endpoint, storage, dependency or telemetry is needed.

## Acceptance

- A successful refresh/search/lifecycle read that removes the selected version
  reports the actual old and replacement IDs, including a request-limit omission.
- Empty results report only the previous ID; first load and retained selection
  produce no replacement announcement or invented identity.
- Out-of-order, malformed, rejected and post-unmount reads cannot alter a newer
  notice; failed reads retain the last-good selection and its notice.
- A manual selection during an in-flight read is the selection evaluated by the
  eventual owned commit. A manual selection afterward clears the notice.
- A later successful unchanged-selection read clears stale membership copy.
  Local paging/filtering does not generate a replacement notice.
- Existing confirmation cancellation, exact version/hash binding, targetVerified,
  guarded approval/activation/rollback payloads and last-good read behavior stay
  unchanged. The notice never initiates any action or request.
- Action/copy feedback remains independent. Live announcements are not duplicated;
  long and unusual IDs remain literal, readable and contained without focus theft.

Verification in a later authorized build should extend the existing isolated
operator unit/browser proofs, including delayed reads and mobile/desktop cases.
Only isolated synthetic loopback browser automation is authorized. Unknown dispatches remain locked;
auth/approval rules, seller-contact and delivery-retry holds remain unchanged.

## Next Gate

Complete the approved local integration and synthetic regression checks, then
independent review. Any publication still requires a separate scope decision.
