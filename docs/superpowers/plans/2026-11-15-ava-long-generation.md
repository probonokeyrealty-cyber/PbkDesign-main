# Ava Long Generation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Remove short chat-generation cutoffs while preserving safe streaming speech and completed-only context.

**Architecture:** The existing Render chat endpoint accepts existing team authentication directly, avoiding the serverless streaming ceiling. Chat-only generation budgets and response preservation are increased; speech retains its independent playback lifetime.

**Tech Stack:** Existing Node bridge, React/TypeScript runtime client, SSE, Node/Jest regressions, Web Audio.

**Spec:** `docs/superpowers/specs/2026-11-15-ava-long-generation-design.md`.

## Global Constraints
- Preserve the staff login, team permissions, provider approval gates, model choice, phone latency policy, and unrelated work.
- No keys in client code, no repeated POST fallback, no cancelled/failed replies in follow-up context.
- Bound resources honestly; do not claim unlimited model output.

## Review Focus
- Netlify chat must not retain a hidden 60-second transport cutoff.
- Provider retries and stream inactivity must respect one shared deadline and Stop.
- Large replies must not silently lose their final sentence in history or speech.
- Auth rejection must remain a rejection, not a cross-origin retry.
- Other requests and phone turns must keep their existing limits.

### Task 1: Browser Transport
- [x] Write failing tests for authenticated direct streaming and completion beyond the old client deadline.
- [x] Implement chat-only trusted Render routing with existing team auth, eleven-minute transport, no replay, and unchanged error handling.
- [x] Verify missing/expired auth, custom/local endpoints, late completion, and Stop.

### Task 2: Generation and Preservation
- [x] Write failing tests for larger provider output, the chat deadline, inactivity cancellation, and complete reply/history tails.
- [x] Implement chat-only 32,768-token/ten-minute policy, 90-second stream inactivity, and bounded 256,000-character preservation.
- [x] Verify ordinary provider calls keep their limits and incomplete output never becomes completed history.

Review fixes: shared proxy/direct chat-intent permissions, narrow trusted PBK preview-origin handling, regression tests for both, and explicit Docker packaging for the shared helper. Existing proxy fixtures load the real shared helper through a whitelisted import.

### Task 3: Release Verification
- [x] Independent review and targeted/build/runtime gates.
- [ ] Deploy the tested continuation of the approved Ava work without overwriting concurrent changes.
- [ ] Verify a live long reply, streaming voice, Stop, completed-only follow-up context, mobile containment, and staff protection.
- [ ] Record exact evidence and remaining platform safeguards.
