# Skill Studio Version-Change Notice Implementation Plan

> **For agentic workers: REQUIRED WORKFLOW:** Use superpowers:subagent-driven-development to implement this plan task-by-task after execution approval. Steps use checkbox (`- [ ]`) syntax for tracking. Planning approval is not execution approval.

**Goal:** Announce automatic skill-version replacement without changing selection or approval behavior.

**Architecture:** Keep selected ID and its replacement notice in one pure reducer state, so a successful owned read evaluates the latest selection and commits a consistent result. Render a small, separate live-status component; retain all existing read-ownership and action-confirmation gates. Reuse the current operator unit and synthetic browser proof entry points.

**Tech Stack:** Existing Node 22, React/TypeScript, `.mjs` utilities with `.d.mts` declarations, Node test runner, TypeScript transpilation, React server rendering, Vite and existing Playwright proofs. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-19-skill-version-change-notice-design.md` (approved design).

## Global Constraints

- Current authorization: the founder approved the browser-free local phase using PBK's subagent workflow. Task 1 and Task 2 Steps 1-4 may proceed, including local candidate commits and Node-only tests. Task 2 browser-proof authorship, route/CSS wiring, browser execution, push, merge and deployment remain outside this phase.
- Base future isolated execution on `8bb21d63ba758cd4f688d8f161c35a674a57a31c`, or an explicitly verified successor containing PR #41. Main does not yet contain PR #41; do not silently substitute it. Keep PR #41 draft and unmerged.
- Before authorized execution, use the git-worktree skill and a separate `codex/skill-version-change-notice` task branch. Carry only these approved documents; do not copy or modify user-owned `output/`.
- Preserve automatic selection, repository limit `150`, debounce `180ms`, request ownership, last-good reads and existing focus behavior.
- Preserve confirmation cancellation, exact version/hash binding, `targetVerified`, approval/activation/rollback payloads and every auth/approval rule. Unknown dispatches remain locked.
- No new backend, endpoint, storage, dependency or telemetry is needed. No seller calls/messages, provider execution, delivery retries or live skill actions.
- Use one separate, unframed status line near the existing page feedback, before the training queue/workspace. Keep its state separate from the current `notice`/`error` action-feedback slot.
- Use polite, atomic live-region semantics; do not announce the same transition repeatedly, move focus, scroll, open a dialog or add an action.
- Render exact IDs as text with wrapping at `320px`, `390px` and desktop widths. Preserve PBK tokens and typography; add no panel, new palette or replacement layout.
- Pending, stale, failed or invalid reads do not create, overwrite or clear the notice. A successful unchanged-selection read clears obsolete notice copy; explicit selection and mobile Repository return clear it too.
- Browser automation remains on hold, including headless synthetic local runs. A `.node-test.mjs` suffix is not proof of browser-free execution. Do not run broad suites without checking their transitive commands and output paths.

## Review Focus

1. Manual selection during a held request must be the selection evaluated when the owned response commits: Task 1 sequence assertion and Task 2 held-read case.
2. First load, empty results and ID `0` must not fabricate a replacement or confuse absence with a valid ID: Task 1 literal cases and Task 2 empty-view case.
3. Older, invalid, failed or post-unmount reads must not replace a newer notice: Task 2 actual route ownership cases.
4. A second status region must not clobber Copy ID/action feedback or invalidate unrelated role queries: Task 2 server-render checks and scoped browser assertions.
5. Long/markup-shaped IDs must remain literal and contained without repeated live updates or focus theft: Task 1 preservation and Task 2 rendering/geometry cases. DOM evidence is not a screen-reader speech certification.

## Files And Ownership

- Task 1: create `src/app/utils/skillReviewSelection.mjs`, its `.d.mts`, and `scripts/skill-review-selection.node-test.mjs`; append that test to `test:operator-workflow-unit` in `package.json`.
- Task 2: create `src/app/components/skills/SkillReviewNotice.tsx` and `scripts/skill-review-notice.node-test.mjs`; modify `SkillStudio.tsx`, the existing `operator-workflows.css`, the existing Skills browser proof and the same unit command.
- No bridge, database, approval policy, CI workflow or unrelated route edits. Task 2 must preserve Task 1's additive package-script change.

## Task 1: Pure Selection And Notice Transition

**Interfaces:** Define and export these types from `skillReviewSelection.d.mts`; implement only the values/function in the matching `.mjs`:

```typescript
export type SkillReviewChange = Readonly<{
  previousId: string;
  replacementId: string | null;
}>;
export type SkillReviewSelectionState = Readonly<{
  selectedId: string;
  change: SkillReviewChange | null;
}>;
export type SkillReviewSelectionAction =
  | { type: 'select'; versionId: string }
  | { type: 'repository'; versionIds: readonly string[] };
export const EMPTY_SKILL_REVIEW_SELECTION: SkillReviewSelectionState;
export function reduceSkillReviewSelection(
  state: SkillReviewSelectionState,
  action: SkillReviewSelectionAction
): SkillReviewSelectionState;
```

The reducer consumes already-validated IDs, not network responses. Preserve ordering and exact strings; do not normalize IDs, infer deletion or accept lifecycle/hash authority. The initial state is `{ selectedId: '', change: null }`.

- [ ] **Step 1: Write the transition tests.** Use literal expected states, not the reducer to compute expectations. Minimum cases:

```javascript
assert.deepEqual(reduceSkillReviewSelection(
  { selectedId: '', change: null },
  { type: 'repository', versionIds: ['SYN-A', 'SYN-B'] }
), { selectedId: 'SYN-A', change: null });
assert.deepEqual(reduceSkillReviewSelection(
  { selectedId: 'SYN-A', change: null },
  { type: 'repository', versionIds: ['SYN-B'] }
), { selectedId: 'SYN-B', change: { previousId: 'SYN-A', replacementId: 'SYN-B' } });
assert.deepEqual(reduceSkillReviewSelection(
  { selectedId: 'SYN-A', change: null },
  { type: 'repository', versionIds: [] }
), { selectedId: '', change: { previousId: 'SYN-A', replacementId: null } });
```

Also assert: an initially empty result has no notice; retained selection does not jump to the first ID and clears an older notice; `select('SYN-C')` and `select('')` clear it; ID `'0'` remains valid; selecting B before committing `[B,C]` retains B with no notice; committing `[C]` after that reports B-to-C, never an earlier A. Freeze inputs and verify repeated evaluation gives equal results without mutation. Preserve long and markup-shaped ID strings exactly.

- [ ] **Step 2: Run the new Node test and observe RED for missing transition behavior.** Command: `node --test scripts/skill-review-selection.node-test.mjs`. Resolve only loader/setup problems before recording behavioral RED; do not mistake a missing dependency for the reproduced gap.
- [ ] **Step 3: Implement the reducer and declarations.** Keep notice and selected ID in the same return value, with no effects, timers, callbacks, global mutation or request handling.
- [ ] **Step 4: Run the complete new Node test.** Expect all transition assertions to pass, zero failures/skips, and unchanged frozen inputs.
- [ ] **Step 5: Append this browser-free test to `test:operator-workflow-unit`.** Preserve all existing command members; add no conditional skip or separate optional gate.
- [ ] **Step 6: Run `npm run test:operator-workflow-unit`.** Expect both prior tests and the new transitions to pass. This existing command uses pure tests and a temporary synthetic HTTP fixture, not a browser; verify that remains true before execution.
- [ ] **Step 7: Run `npm run typecheck`.** Expect exit 0 without relaxing compiler settings.
- [ ] **Step 8: Commit only Task 1 files locally on the isolated task branch after self-review.** Suggested subject: `feat: model skill review selection notices [skip netlify] [skip render]`. This is a candidate for independent review, not task acceptance. No push.
- [ ] **Step 9: Obtain the task's independent review before accepting the candidate.** Address findings within scope; leave an honest verification record.

## Task 2: Live Notice, Route Wiring And Regression Proof

**Interfaces:** Consume Task 1's exports unchanged. Export `SkillReviewNotice({ change }: { change: SkillReviewChange | null }): ReactElement` from the new component; use a type-only import of `SkillReviewChange`.

Keep one mounted `<p>` with class `pbk-skill-review-notice`, `data-pbk-skill-review-notice`, `role="status"`, `aria-live="polite"` and `aria-atomic="true"`. Null change renders no message or visible empty spacing. Use these exact messages, with IDs rendered literally in wrapping `<code>` elements:

- Replacement: `Version {oldId} is not in the current results. Showing {newId}.`
- Empty read: `Version {oldId} is not in the current results.`

- [ ] **Step 1: Write browser-free rendering tests for the actual component.** Reuse the existing TypeScript in-memory transpilation pattern from `scripts/attom-mcp-record-ui.node-test.mjs`, but use real React/JSX runtime and `react-dom/server`, not fake React hooks. Transpile in memory, evaluate with `createRequire`, and render with `renderToStaticMarkup`; import no route, browser, network client or application state. Assert one polite atomic status paragraph, empty text for null, exact replacement/empty wording and both IDs in order, no controls/links, and HTML escaping for an ID such as `SYN-<script>&`. No files or dependencies are generated.

Define test-only `renderNotice(change)` to return that actual server-rendered markup. The test `renders exact replacement IDs without an action` includes these independently derived assertions:

```javascript
const html = renderNotice({ previousId: 'SYN-A', replacementId: 'SYN-B' });
assert.equal((html.match(/role="status"/g) || []).length, 1);
assert.match(html, /aria-live="polite"/);
assert.match(html, /aria-atomic="true"/);
assert.match(html, /Version <code>SYN-A<\/code> is not in the current results\. Showing <code>SYN-B<\/code>\./);
assert.doesNotMatch(html, /<(?:button|a|input)\b/);
assert.match(renderNotice(null), /^<p\b[^>]*><\/p>$/);
assert.match(renderNotice({ previousId: 'SYN-<script>&', replacementId: null }), /<code>SYN-&lt;script&gt;&amp;<\/code>/);
```

Keep null/empty-replacement/escaped-ID cases as separately named tests in the actual suite; the compact examples above pin output rather than prescribing the harness body.

- [ ] **Step 2: Run `node --test scripts/skill-review-notice.node-test.mjs` and observe RED for the absent notice.** Fix harness-only errors separately; do not launch Chromium to make this test work.
- [ ] **Step 3: Implement `SkillReviewNotice` and append its test to the same operator-unit command.** Preserve Task 1's command entry. Keep the live paragraph independent of the global action/error banner.
- [ ] **Step 4: Run both new Node tests.** Command: `node --test scripts/skill-review-selection.node-test.mjs scripts/skill-review-notice.node-test.mjs`. Expect all assertions to pass with zero skips and no browser process/network access.
- [ ] **Step 5: Extend the existing synthetic Skills browser proof without running it yet.** Add cases below inside `verifyReadOwnership` using its real `scenario`/`pair`/`plans`/held-response harness. Extend `scenario(name, execute, initial = pair(), viewport = { width: 1440, height: 900 })` only to permit the new mobile cases; existing callers and all existing cases stay intact. Use `[data-pbk-skill-review-notice]` for the new status. Once integrated, this paragraph remains mounted: assert empty text for no notice, not absence of the node. Scope the existing global status assertions for action/copy feedback to `.pbk-skill-banner[role="status"]`, preserving their original expected messages/counts.

Required new browser assertions (synthetic only, zero real provider writes):

1. Initial `[A,B]` selects A with no notice. Owned refresh/search/lifecycle `[B]` selects B and shows the exact A-to-B message, preserving the initiating control's focus and scroll position. Check an omission representing the existing request limit, without changing that limit.
2. Successful `[]` removes detail and names only A; no B or invented version appears. A later successful result retaining selection clears an older notice. A manual row or training-queue selection and mobile Repository return clear it.
3. During a held read, explicitly select B; release `[B,C]` and assert B/no notice. Repeat with `[C]` and assert B-to-C, not A-to-C. Await existing heading focus before typing subsequent searches; retain the earlier focus-race repair.
4. After an A-to-B notice, run rejected/malformed status and repository reads and assert exact last-good B/notice retention. Release an older held success/error after a newer result; neither may change the new notice. Unmount while held, then remount; the old result must not contaminate the new empty notice state.
5. Paging and local agent/risk/performance filtering create no notice. Same-ID hash/lifecycle refresh creates no ID-replacement message, while existing confirmation cancellation still passes. Open a real synthetic confirmation before replacement and assert its cancellation, unchanged verified-target gating and zero governance POSTs for the notice flow.
6. Copy success and copy failure coexist independently with the review notice; dismissing an action banner does not clear it. For mocked action feedback, hold its ensuing reload: action success/error must not overwrite the notice before a new owned commit. A later successful unchanged-selection reload may clear it under the normal rule. Any explicit mocked action-body proof must keep the existing exact target assertions and no real runtime fallback.
7. In Chromium and WebKit at `1440px`, `390px` and `320px`, long and markup-shaped IDs remain exact text, create no extra DOM/action/link and cause no page/notice overflow or clipped text. Keep both mobile modes accessible. Observe the stable live region's nonempty text updates during an owned replacement under React Strict Mode; expect one committed announcement text change, no duplicate node and no focus theft. Do not claim actual screen-reader speech was tested.

- [ ] **Step 6: Stop before route wiring at the browser verification hold.** The pure reducer and unmounted component may have browser-free evidence after a later local-build approval, but do not integrate them into `SkillStudio.tsx` until the browser regression can first be observed RED. Do not execute `node scripts/skill-studio-workflow-browser-smoke.mjs`, `npm run test:operator-workflow-browser`, `npm run test:composio-research-ui` or any equivalent browser-launching command without explicit authorization. The research UI file imports Playwright despite its Node-test name. Record browser RED/GREEN, geometry and route-ownership checks as **not run**, not passed or skipped; do not mark Task 2 or the feature complete. Run the allowed pure tests/typecheck/lint/build at this checkpoint if execution is paused here.
- [ ] **Step 7: After a separate explicit browser-proof authorization, run the new replacement scenario against the still-unwired route and observe behavioral RED.** It must fail because the real route does not announce replacement, not because of fixture setup, imports or an unavailable browser. If authorization is CI-only, obtain publication approval separately before using CI for this cycle; do not bypass the hold through a remote browser service.
- [ ] **Step 8: Integrate the reducer into `SkillStudio.tsx`.** Replace only the selected-ID state with `useReducer`, deriving the existing `selectedId` local from its state. Dispatch `repository` with the validated result's IDs at the existing owned success commit. Dispatch `select` from `openSkillVersion` and the mobile Repository return. Do not dispatch on request start, failures, malformed reads or local filter/page changes. Preserve each existing focus/inspector side effect and leave `actionOwner`, `targetVerified`, confirmations and bridge calls unchanged.
- [ ] **Step 9: Mount the component after the existing feedback banner and before the training queue/workspace.** Pass only reducer `change`; do not reuse, clear or overwrite `notice`/`error`. Add scoped wrapping/spacing rules to the existing stylesheet, using PBK text/mono tokens and no new theme, card, control or font-size scaling.
- [ ] **Step 10: Run authorized local browser-free checks.** Run `npm run test:operator-workflow-unit`, `npm run typecheck`, `npm run lint`, `npm run build` and `git diff --check` as separate checks; all must pass. Audit transitive scripts first and preserve `output/`. Do not treat SSR/build success as proof of live announcements, viewport geometry or async route ownership.
- [ ] **Step 11: Run the full Skills browser script to establish GREEN under the authorization from Step 7.** Preserve all prior cases, assertions and timeouts. Use synthetic loopback fixtures only, no authenticated user profile/PBK production tab. Screenshots and logs belong in ignored `.pbk-local/operator-workflow/`, never user `output/`. Report actual case counts, both engines, all specified widths and any failed/deferred check; do not infer assistive-technology speech fidelity from DOM checks.
- [ ] **Step 12: Obtain Task 2 and whole-branch independent review.** Review the actual source diff and attributable test results. Keep browser/assistive-technology limitations explicit. No full-pass or release-readiness claim until the authorized verification gates actually pass.
- [ ] **Step 13: Commit only Task 2 files locally after the applicable review gate.** Suggested subject: `feat: announce skill review version replacement [skip netlify] [skip render]`. No push, PR state change, labels, merge, deployment or production action.

## Completion And Release Boundary

The founder approved only the browser-free phase: Task 1 and Task 2 Steps 1-4. Execution progress and review evidence live in this plan's SDD ledger. Task 2 Step 5 and all route integration remain unstarted until the appropriate scope is approved; browser regression verification still needs explicit authorization. Keep that distinction in every task report.

No remote CI runs, disposable database branches or live checks are needed for planning. Later publication requires a separate user decision, then the existing Founder Verify, Tooling Verify, Release Qualification, Neon Auth Mail Verify and PBK Agent Evals gates on the exact published head, with disposable Neon evaluation state only. Do not replace required checks with old-head results or relax them to fit this feature.

PR #41's release remains a separate decision. This plan neither merges that dependency nor authorizes this feature's release.

## Plan Self-Review

- Spec coverage: Task 1 owns exact ID/notice transitions; Task 2 owns live rendering, existing read ownership, feedback independence, guarded actions and all responsive checks.
- Interface consistency: reducer/action/state names and the component's `change` prop are defined once above and used consistently.
- Each Review Focus case has its owning pure/render or actual-route test; browser cases are deliberately held, not represented as local unit coverage.
- No new production API, policy, dependency, storage, telemetry, release workflow or seller operation is required. No implementation commands were run while writing this document.

## Execution Handoff

PBK requires subagent-driven development with a fresh task reviewer and an independent review of the completed browser-free phase. This phase's approval leaves browser automation, browser-proof authorship, route integration, push, merge, deployment and seller-contact holds intact. The remaining whole-plan review follows only after the later integration/verification phase is authorized and completed.
