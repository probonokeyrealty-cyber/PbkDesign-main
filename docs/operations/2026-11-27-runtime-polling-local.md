# Runtime polling reduction - local verification

## Scope

- Local branch: `codex/runtime-state-polling-local-20261127`.
- Checkout: `D:/pbk-temp/operator-session-regressions-20261126`.
- Only production-code change: `src/app/hooks/useRuntimeSnapshot.ts`.
- At the local-verification milestone, before PR packaging: no commits,
  pushes, merges, deployments, billing changes or outbound messages.
- No hosted lead, draft, notes or comp edits. Demo and investor sites untouched.
- Existing unrelated edits in the original C: worktree were left alone.

## Behavior

- Concurrent consumers share full-state, quota and tooling reads within a tab.
- Automatic reads reuse a same-authority result for at most 15 seconds.
- Fallback polling has a 15-second minimum; longer caller intervals remain longer.
- When state frames are fresh, full-state HTTP safety reads occur no more often
  than every 60 seconds. An open socket alone is not treated as fresh state.
- Manual refresh and approval, online and visible-tab events invalidate the
  automatic window and request fresh state immediately.
- Read sharing is scoped to the configured endpoint and request authority.
  Failed responses are not cached; changed sessions reject old responses.
- New stream state wins over older HTTP state. A forced refresh supersedes
  both older successful reads and older failures across consumers.
- Quota/tooling results propagate to all mounted consumers, including panels
  whose timer did not initiate the safety read.
- Complete state payloads and existing provider-write gates are preserved.
  No draft/session storage or lead mutation logic was changed.

This reduces request frequency and duplication; it does not remove full-state
fields. Cross-tab state caches, payload compaction and hosted settings were
not introduced or changed. Savings are not live until a future approved release.

## Reproductions and regression tests

The initial browser test failed because three consumers performed three
hydration reads instead of one. The new test verifies one shared hydration,
no redundant 5/10-second polls, a shared fallback read, immediate refresh
events, healthy/stalled/disconnected streams, authority replacement, outages,
reload persistence, independent tabs and mobile overflow.

Independent review identified two further races. Both were reproduced with
controlled browser tests before fixing: late-panel quota/tooling starvation,
and an older read failure overriding a newer successful cross-panel refresh.
The final review found no blocker in the corrected error path.

The actual Analyzer fixture additionally runs the production hook with
`--runtime-polling`. It checks that HTTP reads, real mocked WebSocket frames
and reconnect events leave its actual dirty draft, notes and saved comp
unchanged. Its existing overlapping-writer and session-recovery cases also run.

## Verification

All commands completed successfully:

```text
npm run typecheck
npm run build
node node_modules/eslint/bin/eslint.js src/app/hooks/useRuntimeSnapshot.ts
node scripts/runtime-polling-browser.node-test.mjs
node --test scripts/command-center-polish-browser.node-test.mjs
node scripts/runtime-read-recovery-browser-smoke.mjs
node scripts/today-review-browser-smoke.mjs
node scripts/analyzer-draft-recovery-browser-smoke.mjs --runtime-polling
git diff --check
```

- Polling regression: Chromium 1440px and WebKit 390px.
- Actual shell: five tests including desktop dark/light, Chromium 320px and WebKit 390px.
- Read recovery: 33 cases across desktop Chromium, WebKit mobile and Chromium 320px.
- Approval review: Chromium 1440px/390px and WebKit 390px.
- Actual Analyzer: Chromium 1440px and WebKit 390px/320px, including manual
  notes, saved comp, overlapping writers, queued lifecycle and session recovery.
- Build reported a non-fatal large-chunk warning. Git reported LF-to-CRLF
  normalization notices, but no whitespace errors.
- Full founder and hosted smoke suites were not run.
- During PR packaging, an additional full unit run was attempted with provider
  and database credentials excluded from the child process. Eleven suites
  completed with 918 passing tests and no reported failures before the run
  exceeded ten minutes in the unchanged backend fixtures. It was stopped while
  `runtime-coverage-store.test.mjs` was active. This is an incomplete unit run,
  not a full-suite pass; no unrelated backend code was changed to shorten it.

Browser contexts used fictional sample state and blocked or mocked provider
and CRM writes. No personal browser profile or existing PBK tab was modified.
Screenshots are in `output/playwright/` and `output/command-center-polish/`.

## Hosted boundary check

Netlify's saved controls still require team login for `all` deploys. Published
deploy remains `6b091f95d4a16de1f37574fa`, ready/current. No protection settings
were written during this task. The live demo and investor projects were not changed.

## Local preview

`node scripts/runtime-polling-preview.mjs` serves the built application with
fictional GET responses on a random loopback port. It rejects provider/CRM
writes and its CSP blocks external connections. It is not a live-data server.
The started preview URL is recorded in `output/runtime-polling-preview.log`.
