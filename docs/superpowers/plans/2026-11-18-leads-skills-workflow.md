# Leads And Skill Studio Workflow Implementation Plan

> **For agentic workers:** REQUIRED WORKFLOW: Use superpowers:subagent-driven-development to implement this plan task-by-task. Each task has independent spec and code review before the next begins, followed by whole-branch review. Steps use checkbox (`- [ ]`) syntax for tracking. PBK's `subagent-release-alignment-smoke.mjs` requires this workflow; do not substitute the generic execution alternative or weaken its guard.

**Goal:** Improve scanning, keyboard movement, truthful labels and evidence clarity in PBK's existing Leads and Skill Studio pages without changing operational policy.

**Architecture:** One cohesive worklist upgrade, with independently testable Leads and Skill Studio slices sharing a small focus-only helper. Keep existing components, section anchors, bridge operations and identity ownership. Separate evidence presentation from ranking and governance; add no backend capability.

**Tech Stack:** Existing React/TypeScript, CSS tokens, Lucide, Vite, Node 22, Node test runner and repository Playwright Chromium/WebKit fixtures. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-18-leads-skills-workflow-design.md` (founder approved for planning).

**Local execution status (2026-11-18):** The founder's continue authorized local
implementation and isolated synthetic proof. Tasks 1-5 are recorded in the SDD
ledger; Task 6 local execution from `baa8812` is DONE_WITH_CONCERNS, with exact
results in `docs/operations/2026-11-18-operator-workflow-validation.md`.
For Task 6 the founder explicitly
requested self-review with no subagents/reviewers. Final whole-branch review,
controller receipt/manual handoff and the full founder release gate remain
pending; this is not publication or live-operation approval.

## Global Constraints

- Work locally on `codex/leads-skills-workflow-design`, based on main `5cb15fb69851406126a6faff2d5e0c13f47f8920` plus design-only commit `545ae36`. Never copy the unmerged PR #35 runtime into this branch.
- PR #35 stays draft and unmerged. No push, PR creation, merge, deployment, migration, live provider test, seller contact, delivery retry or live governance mutation.
- Preserve auth/approval rules, exact IDs/content hashes, unknown dispatch locks, DNC/TCPA logic, pending-action ownership, rollout settings and current server authority. Rex stays in Brain.
- Keep the existing rail width, header, favorite links and mobile navigation. Preserve property/ATTOM/photo/comp work from PR #38, existing legacy entry behavior, Electron, local drafts and memory scope.
- Keep graphite/sky/amber tokens, Fraunces/Geist/JetBrains Mono and Lucide. Starting spacing is 12px row gutters and 16px detail padding; item radii remain the existing 8px where applicable. No new palette, shell, tabs, sheets, hero or state store.
- Verify 1440/390/320px, minimum 44px interactive targets, wrapped long text, visible focus, and no horizontal viewport overflow. Do not shrink text with viewport width or use negative letter spacing.
- Arrow Up/Down and Home/End change focus only within the visible current-page selection buttons. Enter/Space keep existing native selection. Existing links navigate; no key auto-runs an action.
- Use Phone format OK and Email format OK for the current `callable` and `contract` filter values; predicates and URL/return keys stay unchanged.
- Missing evidence is Not recorded/Unknown, not measured zero. Do not infer a 30-day/weekly window, completion, permission, history or production readiness.
- Existing roster/detail/repository/status and documented read/session requests are allowed. New navigation/filter/copy/preview behavior must make zero paid-provider lookups and zero business/governance writes.
- Use synthetic fixtures only, deny non-loopback HTTP/WebSockets, preserve user-owned `output/`, and store new screenshots/evidence in `.pbk-local/operator-workflow/` instead.
- No implementation, installation, server startup or browser test is authorized until the founder reviews this plan. Plan approval must explicitly cover the isolated repository browser verification below; never reuse a live Chrome profile for automated fixtures.

## Review Focus

1. Hidden duplicate desktop/mobile buttons, non-first pages and vanished focused rows: focus remains in the visible list or moves to its search fallback, never another record or an unrelated control. Tasks 1/2/4.
2. Zero versus absent, malformed/prototype-key data and mixed fraction/percent inputs: display stays truthful while existing ranking and eligibility remain unchanged. Tasks 3/4.
3. Older successful/failed GETs arriving after a newer search or unmount: old responses cannot replace the current version, error, loading state or confirmation target. Task 5.
4. Preview/wizard edits during focus movement, harmless refresh, failed reads and selection changes: preserve current ownership and deliberate new-version seeding, without adding cross-session persistence. Tasks 4/5.
5. Long identities/errors, clipboard denial, confirmation Cancel and server rejection: usable responsive layout and exact targets, no false success or extra mutation. Tasks 2/4/5/6.

## File Map And Ownership

| Task | Create/modify | Responsibility |
| --- | --- | --- |
| 1 | Create `src/app/utils/worklistFocus.mjs`, `src/app/utils/worklistFocus.d.mts`, `scripts/worklist-focus.node-test.mjs` | Pure key/index decision plus narrowly scoped DOM focus handling; no selection callback or business imports. |
| 2 | Modify `src/app/routes/Leads.tsx`, `src/app/routes/LeadPortal.tsx`; create `src/styles/operator-workflows.css`, `scripts/fixtures/operator-workflow-fixture.mjs`, `scripts/leads-workflow-browser-smoke.mjs`; adjust `scripts/lead-queue-return-browser-smoke.mjs` | Leads labels, identity hierarchy, keyboard/focus recovery and workspace anchors; shared synthetic preview infrastructure. |
| 3 | Create `src/app/utils/skillEvidenceDisplay.mjs`, `src/app/utils/skillEvidenceDisplay.d.mts`, `scripts/skill-evidence-display.node-test.mjs` | Nullable evidence display and safe lifecycle display, independent of ranking or governance. |
| 4 | Modify `src/app/routes/SkillStudio.tsx`, `src/styles/operator-workflows.css`, `scripts/fixtures/operator-workflow-fixture.mjs`; create `scripts/skill-studio-workflow-browser-smoke.mjs`; adjust `scripts/skill-studio-ui-smoke.mjs`, `scripts/skill-studio-design-browser-smoke.mjs` | Version identity, evidence-first sections, honest counters, Copy ID and wizard/preview containment. |
| 5 | Modify `src/app/routes/SkillStudio.tsx`, `scripts/leads-workflow-browser-smoke.mjs`, `scripts/skill-studio-workflow-browser-smoke.mjs`; touch `src/app/routes/Leads.tsx` only for a failing target-ownership regression | Latest-read ownership, retained-data labeling and unchanged exact-target confirmations. |
| 6 | Modify new browser smokes, `package.json`, `.github/workflows/release-qualification.yml`, `scripts/release-qualification-ci.test.mjs`; create `scripts/operator-workflow-local-preview.mjs`, `docs/operations/2026-11-18-operator-workflow-validation.md` | Final responsive/non-mutation proof, mandatory test wiring and accurate local verification receipt/preview. |

Task 6's new browser smokes are the two full paths listed under Task 5. No bridge,
migration, provider config, package dependency, lockfile or shared shell changes
are planned. Tasks are sequential; shared files are not edited by simultaneous
workers.

## Task 1: Focus-Only Worklist Navigation

**Interfaces:**
- `getWorklistFocusIndex(key: string, index: number, count: number, options?: { modified?: boolean; composing?: boolean }): number | null`.
- `focusWorklistRow(event: React.KeyboardEvent<HTMLButtonElement>): boolean`, declared in `.d.mts`; `.mjs` has no React runtime import.
- DOM contract: a root has `data-pbk-worklist="leads"` or `"skills"`; its main selection buttons have `data-pbk-worklist-row`. Keep existing identity attributes too.

- [ ] **Step 1: Write failing Node tests** for current-page clamping (no wrap), Home/End, zero/invalid count/index, modified/composing keys, Enter/Space pass-through, foreign/nested event targets, hidden/disabled/disconnected rows, and two independent roots. Mock only minimal DOM methods; the browser tasks prove real geometry.

```js
assert.equal(getWorklistFocusIndex('ArrowDown', 0, 3), 1);
assert.equal(getWorklistFocusIndex('ArrowDown', 2, 3), 2);
assert.equal(getWorklistFocusIndex('End', 0, 3), 2);
assert.equal(getWorklistFocusIndex('Enter', 0, 3), null);
assert.equal(getWorklistFocusIndex('Home', 1, 3, { modified: true }), null);
```

- [ ] **Step 2: Run RED:** `node --test scripts/worklist-focus.node-test.mjs`; expect the missing module/export or targeted assertion to fail, not environment setup.
- [ ] **Step 3: Implement the two signatures and declarations.** Resolve only the current button's closest worklist root. Require the key event to originate on that selection button. Query only root-owned, connected, visible, enabled selection buttons, excluding nested worklist roots; ignore modifiers and native composition. Prevent default and focus only a valid target; never click, select, page, dispatch, fetch or modify storage. Return true only for a handled focus key.
- [ ] **Step 4: Run GREEN:** same Node command, all tests pass with zero skips; `npm run typecheck` passes. Verify the helper has no bridge/network imports or business callbacks.
- [ ] **Step 5: Review and commit** only these three files: `feat: add scoped focus-only worklist navigation [skip netlify] [skip render]`.

## Task 2: Leads Workflow And Workspace Navigation

**Consumes:** Task 1 focus helper; `CompactPager` and `OPERATOR_LIST_PAGE_SIZE` (currently 10); existing identity/queue-return handlers.

**Produces:** Unchanged `Leads()`/`LeadPortal()` exports and URL/return contracts;
root/row DOM attributes from Task 1. The fixture exports
`createOperatorWorkflowPreview(port?: number): Promise<{ server: ViteDevServer; origin: string }>`
and `operatorLeadFixtures: Array<Record<string, unknown>>` (at least 60 synthetic,
canonical-ID-bearing leads). Only the generated loopback origin serves fixtures.

- [ ] **Step 1: Capture the unchanged Leads baseline.** First inspect the existing smoke's isolated targets and request mocks. Run `scripts/leads-design-browser-smoke.mjs` with session-scoped `PBK_LEADS_DESIGN_SCREENSHOTS=1`, then move only its newly generated baseline captures into `.pbk-local/operator-workflow/before/`. Preserve existing files and record any baseline failure rather than accepting it as a new regression. No UI edit precedes this capture.
- [ ] **Step 2: Add the failing browser assertions and fixture together.** New smoke uses Chromium and WebKit at 1440/390/320. Assert label changes preserve the old predicates, original filter URL keys and exact match membership. Focus later-page rows with Arrow/Home/End without changing selection/GET count; Enter and Space select through the existing handler, the existing workspace link navigates, Back restores filter/page/row/focus. Add hidden mobile/desktop duplicates, removed focused row, search/quick-action keyboard isolation, long IDs and empty filtered results. Preserve a sentinel Compose/Analyzer draft, manual values, reviewed comps and property snapshots. Include mocked existing create/edit/call/SMS/contract Cancel and server-rejection behavior, with exact targets and no actual outbound traffic.

```js
await page.getByRole('button', { name: 'Phone format OK', exact: true }).click();
await rowA.focus();
const selectedBefore = await selectedIds(page);
const readsBefore = leadDetailReads.length;
await rowA.press('ArrowDown');
await expect(rowB).toBeFocused();
assert.deepEqual(await selectedIds(page), selectedBefore);
assert.equal(leadDetailReads.length, readsBefore);
assert.deepEqual(businessWrites, []);
```

`selectedIds(page)` is a local test helper returning visible selection-button
`data-lead-queue-id` values whose `aria-pressed` is true; it does not access app state.

- [ ] **Step 3: Run RED:** `node scripts/leads-workflow-browser-smoke.mjs`; expect the new label/focus assertion to fail on unchanged UI. Bootstrap failures do not count as RED.
- [ ] **Step 4: Wire existing selection buttons to Task 1, without global key listeners.** Keep native `aria-pressed`, nested quick-action semantics and page boundaries. Add 12px/16px page-scoped spacing, wrapping and selected/focus treatment in the new stylesheet, imported by both routes after their existing styles. Use Phone format OK/Email format OK only for visible syntax-filter labels; keep `callable`/`contract` values and validators unchanged. Keep loaded/filtered/page counts distinct and snapshot caveats. Preserve IDs/keys when reordering read-only identity/context/action groups; separate Delete from navigation/outreach.
- [ ] **Step 5: Preserve workspace anchors and focus recovery.** Reuse `jumpToSection`, the existing return validators and request guards. Highlight the visible existing section with `aria-current="location"` (scoped observation with cleanup), without new reads, history entries or panels. Fall back to search/heading only when a previously owned focused row disappears and focus otherwise falls to the document; never steal focus from search, pager, a dialog or another control. Preserve current return-restoration precedence. Update the old queue-return test's Contract ready selector to Email format OK while retaining its no-email exclusion assertion.
- [ ] **Step 6: Run GREEN:** new smoke, `node scripts/lead-queue-return-browser-smoke.mjs`, `node scripts/faster-triage-browser-smoke.mjs`, `npm run test:lead-controls-safety`, `npm run typecheck`. All pass; new smoke records zero foreign traffic, provider lookups, unexpected writes and page errors.
- [ ] **Step 7: Review and commit** only the Task 2 file set: `feat: improve in-place lead triage and navigation [skip netlify] [skip render]`.

**Fixture safety contract:** Set its bridge target to the generated loopback
origin; serve only synthetic GET data and the existing explicit read/session
bootstrap response. List approved endpoint/method pairs, including route ID
matches, in code. Unknown API/invoke operations fail visibly instead of returning
generic success. Block foreign HTTP and WebSockets, paid property lookups and all
business/governance writes. Test-level fulfilled business/governance requests
belong only to the explicit mock confirmation scenarios in Tasks 2/4/5, never
the preview server; match exact endpoint, method, target and body.
Keep CSP local, reuse local fonts/assets and close servers/browsers in finally.

## Task 3: Truthful Skill Evidence Display

**Produces (new `.mjs` and matching `.d.mts`):**
- `readRecordedCount(value: unknown): number | null` (finite nonnegative safe integer).
- `readSkillEvidenceDisplay(item: unknown): { usageCount: number | null; successPercent: number | null; confidencePercent: number | null; changePercent: number | null; lastTriggeredAt: string | null }`.
- `formatSkillMetric(value: number | null, kind: 'count' | 'percent' | 'change'): string`.
- `getSkillStageDisplay(state: unknown, labels: Readonly<Record<string, string>>, steps: Readonly<Record<string, number>>): { label: string; index: number | null }`.

- [ ] **Step 1: Add failing Node tests** for missing versus zero, strings/numbers, booleans/arrays/objects, negative/fractional/unsafe counts, malformed explicit metrics, NaN/Infinity/out-of-range percentages, fraction/percent boundaries, invalid timestamps, prototype-key lifecycle strings and frozen-input non-mutation.

```js
assert.equal(readSkillEvidenceDisplay({}).usageCount, null);
assert.equal(readSkillEvidenceDisplay({ usageCount: 0 }).usageCount, 0);
assert.equal(readSkillEvidenceDisplay({ confidence: 0.8 }).confidencePercent, 80);
assert.equal(readSkillEvidenceDisplay({ confidence: 80 }).confidencePercent, 80);
assert.equal(readSkillEvidenceDisplay({ confidence: 101 }).confidencePercent, null);
assert.equal(formatSkillMetric(null, 'percent'), 'Not recorded');
assert.equal(formatSkillMetric(0, 'percent'), '0%');
assert.equal(getSkillStageDisplay('__proto__', labels, steps).index, null);
```

`labels`/`steps` in the test are small own-key fixtures matching the route's
existing STATE_LABELS/STATE_STEP contract, including index 0 and index 6.

- [ ] **Step 2: Run RED:** `node --test scripts/skill-evidence-display.node-test.mjs`; expect missing exports/targeted assertions.
- [ ] **Step 3: Implement display-only normalization.** Reuse the ordered raw/outcomes/metrics aliases already listed in `getSkillPerformance` for uses, wins/losses, success, confidence, change and last-trigger time. Ignore absent/null/blank aliases; the first present malformed alias yields unknown rather than a lower-priority apparently valid value. Do not coerce booleans or objects. Accept finite numeric strings. Percent values in [0,1] map to [0,100], values >1 through 100 stay percent; signed change applies the analogous [-1,1]/[-100,100] convention. Out-of-range values are unknown, not clamped successes. Only when all explicit success aliases are absent, preserve the current valid wins/(wins+losses) derivation with known positive usage and valid counts; a malformed explicit success rate does not get replaced by derivation. Parse valid timestamp strings or return null. Use own-key checks for lifecycle maps and indices 0-6; unknown maps to Unknown/null. Never mutate records or import a bridge.
- [ ] **Step 4: Format null as Not recorded, recorded zero as 0/0%, positive change with + and no inferred period.** Counts remain counts; formatting accepts already normalized percentages. Run the Node suite and typecheck GREEN, all cases pass with zero skips.
- [ ] **Step 5: Review and commit** only these three files: `feat: add truthful skill evidence presentation [skip netlify] [skip render]`.

## Task 4: Skill Studio Identity And Evidence Hierarchy

**Consumes:** Task 1 helper, Task 3 display model, existing `copyToClipboard(content): Promise<boolean>` from `src/app/utils/fileExport.ts` and current UI feedback convention.

**Produces:** Unchanged `SkillStudio()` export/governance request contracts;
Task 1 root/row attributes plus `data-skill-version-id` on selection buttons.
Extend the synthetic fixture with at least 60 distinct skill versions and
explicit repository/status reads, including absent/zero/malformed evidence.

- [ ] **Step 1: Capture the unchanged Skill Studio baseline.** Inspect the existing design smoke's isolated targets/mocks, then run it with session-scoped `PBK_SKILL_SCREENSHOTS=1` and preserve only its newly generated captures in `.pbk-local/operator-workflow/before/`. Record baseline failures. Complete this before editing Skill Studio or adding its CSS selectors.
- [ ] **Step 2: Write failing browser assertions.** Add `scripts/skill-studio-workflow-browser-smoke.mjs`: focus-only movement on later pages, native Enter/Space selection, exact version ID, same-key instructions/provenance, clipboard success/failure, recorded-zero versus unknown ribbon/cards/queue copy, no guessed periods, unknown lifecycle, neutral earlier stages, unchanged simulator outputs and no new tabs. Check wizard values survive every existing step, resize and section navigation; explicit new-version selection retains current scenario seeding. Verify top/worst/review queue ordering and eligibility match the current source semantics even though display normalization is stricter.

```js
await expect(page.getByText('Recorded uses', { exact: true })).toBeVisible();
await expect(metric('Recorded uses')).toHaveText('Not recorded');
await selectVersion(recordedZeroVersionId);
await expect(metric('Recorded uses')).toHaveText('0');
await expect(page.locator('#skill-outcome-proof')).toHaveCount(1);
await expect(page.locator('#skill-simulator')).toHaveCount(1);
assert.deepEqual(governanceWrites, []);
```

`metric(label)` is a local locator helper scoped to the selected version's
recorded-outcomes section. `selectVersion(id)` clicks its visible native row.

- [ ] **Step 3: Run RED:** new skill browser smoke; expect the identity/metric/keyboard assertion to fail, not a fixture setup error.
- [ ] **Step 4: Integrate the helpers in existing sections.** Put recorded outcomes before the decision, reorder the existing anchor links accordingly, retain all anchor IDs, saved-instructions disclosure, inspector and mobile Repository/Inspect controls. Keep the original Simulation only status; make preview naming truthful without a new evaluation button/banner tutorial. Add exact version ID and explicit Copy ID (not URL), with an accessible Lucide icon and success only when the existing clipboard utility returns true. Keep seven lifecycle positions, current-state highlight and neutral prior markers instead of checkmarks claiming tests passed; unknown states get no inferred current/completed stage.
- [ ] **Step 5: Normalize only visual metric consumers.** Use Recorded uses and Change without an unverified time window. Read raw optional status counts through `readRecordedCount`; unknown is not a fresh zero/healthy state. Replace visual `buildSkillOutcomeProof`/repository/training-card metric copy with the new view model, but keep `getSkillPerformance`, `buildSkillTrainingQueue` priority/reason/action computation, sorting/filter eligibility, request bodies, rollout defaults and primary-action state branches unchanged. Preserve instructions/preview/wizard keys and existing confirmation Cancel behavior. Extend only scoped CSS for 44px targets, stepper/footer containment and wrapping.
- [ ] **Step 6: Run GREEN:** new skill browser smoke, `node scripts/skill-studio-ui-smoke.mjs`, `node scripts/skill-studio-design-browser-smoke.mjs`, Task 3 Node suite and typecheck. Update old N/A text assertions only to the specified Not recorded state; retain zero-versus-missing, simulation-only, expectedHash, confirmation and activation/rollback tests. Do not remove assertions to make layout pass.
- [ ] **Step 7: Review and commit** the Task 4 file set: `feat: clarify skill identity evidence and preview workflows [skip netlify] [skip render]`.

## Task 5: Latest-Read And Confirmation Ownership

**Interfaces:** Existing bridge APIs stay untouched. Within `SkillStudio`, use
`repositoryViewState: 'loading' | 'ready' | 'retained' | 'unavailable'` solely for
view/read ownership, and a component-local monotonically increasing request ID
with unmount invalidation. No clock freshness threshold or shared state authority.

- [ ] **Step 1: Add failing delayed/reversed-read cases** to the new browser smokes: old success after newer success, old error after newer success, latest failure with retained data, unmount during read, malformed/ok:false repository response, same-version refresh while editing preview, and selection/search change while a confirmation is open. Assert exact IDs/fields/hashes in the visible UI and captured mock requests. When a focused row disappears, focus search only if the page still owns focus and another control has not acquired it.
- [ ] **Step 2: Run RED:** both new browser smokes. Record the actual ownership/reset failure. If an existing guard already passes a case, keep the regression and do not add redundant state/code.
- [ ] **Step 3: Bound `load()` updates to the latest mounted Skill Studio read.** Only the current successful repository/status response may set current data/ready/loading/error. Retain last-good data under its own identity on current failure, label it Saved/retained unless an existing timestamp is available, and do not enable a write with an unverifiable or changed target. Unknown/failed reads cannot settle a newer request or confirmation. Leave canonical eligibility and server approval rules intact.
- [ ] **Step 4: Preserve same-version preview edits across harmless refresh.** Seed the scenario on deliberate version identity change/initial resolved selection, not merely a new object instance for the same version. Keep current new-version seeding, wizard lifecycle and lack of cross-session persistence. Keep existing confirmation closure/selection reset and immutable request target; a mock server rejection is shown without success, retry or a second POST. Leads retains its existing request-generation/ID guards unless a test exposes a real gap.
- [ ] **Step 5: Run GREEN:** both smokes plus existing lead queue-return, skill UI/design and governance unit suites. All targeted race assertions pass; no unhandled page errors, extra writes or foreign reads.
- [ ] **Step 6: Review and commit** only actual state fixes and their tests: `fix: preserve exact workflow targets during asynchronous reads [skip netlify] [skip render]`.

## Task 6: Responsive Proof, Test Wiring And Safe Local Preview

**Consumes:** Tasks 1-5 and their isolated fixture. No new provider/database credentials.

- [ ] **Step 1: Finish browser acceptance coverage** for both engines at all three widths. Assert document scroll width <= viewport width, minimum 44px visible targets, visible search, wrapped long/unbroken IDs/errors, readable focused/selected states and original rail/mobile flow. Assert every selected lead/version and copied ID is exact. Test the fixture server's own deny responses for unknown API methods/targets and every business/governance write, without relying only on page interception. Save synthetic screenshots under `.pbk-local/operator-workflow/` and compare against the before captures from Tasks 2/4, not an invented new theme; do not change/delete user `output/`.
- [ ] **Step 2: Add the test-wiring regression before configuration changes.** Extend `scripts/release-qualification-ci.test.mjs` to require an unconditional Run operator workflow browser proof step after the existing browser installation, with both new smoke commands, no skip/selectors/continue-on-error, Node 22 and unchanged permissions. Assert new unit suites are included in the existing founder path. Run that Jest suite RED before wiring the scripts.
- [ ] **Step 3: Wire focused checks without changing dependencies or limits.** Add package scripts `test:operator-workflow-unit` (both new Node suites) and `test:operator-workflow-browser` (both new browser smokes); include the unit script after the existing founder unit gate and the browser script in the new mandatory release-qualification step. Preserve every existing required check, six-suite zero-skip assertion, timeout, branch trigger and permission. No workflow dispatch or push is authorized now.
- [ ] **Step 4: Run the full local verification set below** sequentially where timing-sensitive. Capture exact pass/fail/skip counts; do not claim a filtered rerun is a whole-suite pass. Resolve real regressions without weakening security/evidence assertions or increasing limits.
- [ ] **Step 5: Create `scripts/operator-workflow-local-preview.mjs`** as a thin launcher for the synthetic fixture only. Bind literal 127.0.0.1 on an available port; if a requested port is occupied, choose another. It has no runtime/provider fallback and no writable business/governance endpoints. Start it only after local execution is approved, visually inspect via the requested Chrome/BrowserOS surface, and return the actual local URL. Leave the current live seller/Analyzer tabs and their drafts untouched. If browser access is blocked, report that gap; do not bypass it or claim visual verification.
- [ ] **Step 6: Write the validation receipt** with base/head, changed surfaces, exact commands/counts, inspected screenshots, request-denial evidence, preserved draft/identity sentinels, any remaining gaps and the no-contact/no-production boundary. Independent whole-branch spec/code review follows. Commit only reviewed changes and the accurate receipt; leave all code local pending a separate publish request.

### Verification Commands At Execution Time

Use a session-scoped Node 22 PATH matching CI; do not replace the system Node or
edit provider environment files. These commands are planned, not run evidence.

```sh
node --test scripts/worklist-focus.node-test.mjs scripts/skill-evidence-display.node-test.mjs
node scripts/leads-workflow-browser-smoke.mjs
node scripts/skill-studio-workflow-browser-smoke.mjs
node scripts/leads-design-browser-smoke.mjs
node scripts/skill-studio-design-browser-smoke.mjs
node scripts/lead-queue-return-browser-smoke.mjs
node scripts/faster-triage-browser-smoke.mjs
node scripts/lead-workspace-guidance-browser-smoke.mjs
node scripts/fleet-context-browser-smoke.mjs
node scripts/lead-property-workspaces-browser-smoke.mjs
node scripts/skill-studio-ui-smoke.mjs
npm run test:lead-controls-safety
node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand --runTestsByPath scripts/skill-governance-schema.test.mjs scripts/skill-governance-store.test.mjs scripts/skill-runtime-snapshot.test.mjs scripts/release-qualification-ci.test.mjs
npm run typecheck
npm run lint
npm run build
node scripts/subagent-release-alignment-smoke.mjs
git diff --check
```

Then run the existing full founder gate before calling the branch ready to
publish. Existing hosted/BrowserOS checks remain required where applicable,
but first inspect their targets/effects: only isolated fixture/local/read-only
checks are authorized by plan execution. Do not run a live hosted smoke that can
write/contact providers. If a required check cannot be safely isolated, report
it as blocked rather than bypassing gates or claiming production readiness.

## Self-Review And Execution Handoff

Plan self-review checked spec coverage, exact interfaces/types, all five Review
Focus classes, task independence and plan size. Spec coverage: Leads/filter/
queue/anchors -> Task 2; evidence/lifecycle/missing data -> Tasks 3/4; preview/
wizard/governance identity -> Tasks 4/5; request boundaries and all responsive
criteria -> Tasks 2/4/5/6. Deferred capabilities remain deferred.

The founder must review this plan before execution. PBK requires subagent-driven
implementation with fresh independent spec/code reviews per task, and final
whole-branch review. This is not authorization to publish, merge, deploy or run
real seller/provider/governance actions. Planning changes only these documents;
current UI, auth/approval policy, production data and PR #35 remain untouched.
