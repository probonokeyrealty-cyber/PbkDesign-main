# Ava Token Streaming Implementation Plan

> **REQUIRED WORKFLOW:** Use superpowers:subagent-driven-development with test-driven development and independent code review for each boundary below. Deployment requires explicit release approval.

**Goal:** Display Ava's safe answer while DeepSeek is generating it, without buffering the complete answer or relaxing approval gates.

**Architecture:** Keep the authenticated POST `/api/assistant/chat` route and JSON compatibility. Requests accepting `text/event-stream` receive cumulative `answer` snapshots followed by a `done` event containing the existing final response. DeepSeek still produces its structured decision; streaming requires complete non-action metadata before the reply, sanitizes and controller-checks visible prefixes, and never forwards reasoning or tool JSON. Tool/action paths retain their existing controller behavior and emit only finalized results.

**Tech Stack:** Existing Node bridge, React, Netlify Fetch-style streaming adapter, `eventsource-parser`, and `@streamparser/json`.

## Constraints

- Existing team authentication, permissions, site protection and provider approvals remain mandatory.
- Preserve the 30-second shared model budget, 40-second proxy budget and 45-second browser budget.
- Cancellation aborts upstream fetches; no transparent POST replay after partial delivery.
- Incomplete replies are visibly interrupted and cannot become successful persisted history.
- Raw reasoning, decision JSON, tool arguments, credentials and controller internals never enter answer events.
- Keep the non-streaming API and seller phone behavior compatible.

## Work

- [x] Add failing provider-stream tests: early answer before upstream completion, fragmented UTF-8/JSON, unsafe metadata, reasoning/tool suppression, unfinished stream, cancellation and token accounting.
- [x] Implement provider SSE parsing, metadata-first reply extraction, prefix checks, final validation, route streaming and disconnect cancellation.
- [x] Add failing proxy tests and implement non-buffering authenticated streaming through a Fetch-style adapter, preserving existing legacy-helper behavior.
- [x] Add failing browser/client tests and implement streamed exchange, Stop, errors, reload/history semantics and responsive wrapping.
- [x] Run full unit, build, lint, typecheck, bridge and packaging checks; independently review and resolve findings.
- [x] Deploy the scoped tested release and prove hosted answer bytes arrive before the completion event; recheck staff-site privacy.

## Review Focus

Malformed and reordered model decisions; stale sessions and verifier outages; interruption after visible text; retry after partial output; final controller rejection replacing a provisional answer; browser unmount/reload; multibyte characters split across network chunks.

## Review Corrections

- Explicitly install both parsing dependencies in the runtime Docker stage, not only the frontend stage.
- Apply credential and tagged-reasoning redaction to the final reply and decision metadata as well as previews; honor controller rewrites in the final streamed result.
- Retain received billing usage even if the terminal provider marker is missing; the answer remains interrupted.
- Export the old callable helper as `legacyHandler`, not `handler`. Netlify otherwise selects its buffered API v1 entry point even with a default Fetch handler. Actual CLI-built manifests confirm the original entry used runtime API v1 and the corrected entry uses API v2.
- Coalesce progress snapshots to 50ms intervals and an 8MiB progress-only wire budget, leaving headroom under the hosted streaming limit. The first safe words and the final authoritative reply are not delayed or truncated. Lexical-boundary scanning is linear even for an unusually long word.

## Initial Hosted Proof

Release `e4121cf` served a native `deepseek-v4-flash` completion: first answer at 1063ms, completion at 7588ms, 3596 characters, and the final reply matched its last streamed preview. Authenticated Chrome also showed a growing reply with Stop still available before completion. The follow-up batching change passed 50 suites (726 unit tests, 8 skipped), 17 client tests, and independent review.
