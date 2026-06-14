# Silent Error Governance

Silent-error governance prevents PBK from pretending an action succeeded when it
failed, fell back, used stale data, or hit an unknown provider state.

## Launch-Blocking Classes

| Class                      | Severity | Required Behavior                             |
| -------------------------- | -------- | --------------------------------------------- |
| security exposure          | critical | Block launch until fixed.                     |
| missing schema             | critical | Block feature until migration is applied.     |
| duplicate identity         | critical | Block or merge before timeline writes.        |
| unlabeled fallback         | high     | Label source, reason, and recovery path.      |
| provider delivery unknown  | high     | Mark reconcile required and retry safely.     |
| stale truth                | high     | Show freshness and block high-stakes actions. |
| missing provider proof     | high     | Do not show success.                          |
| recoverable provider error | medium   | Show failed reason and retry path.            |

## Rules

- Every fallback must be labeled.
- Every provider write must produce proof, failure, or reconcile state.
- Every stale data response must include freshness/source metadata.
- Every duplicate lead risk must prefer canonical identity resolution.
- Every high-risk action must pass safety and approval gates.
- Every launch-blocking finding must have a test or smoke assertion.

## What Counts As Silent

An error is silent if:

- the UI shows success without provider proof
- fallback data looks authoritative
- an old control bypasses the new bridge path
- a failed provider action does not write timeline/runtime archive state
- a duplicate seller timeline is created from a known phone/email
- a stale model response is spoken without contract/freshness guard

## Operator Response

1. Capture screenshot or timeline event.
2. Check `/api/runtime/archive`.
3. Check `/api/circuit/status`.
4. Check source label/freshness.
5. Identify provider proof or missing proof.
6. Create or update a regression test.
7. Fix the bridge path, not only the UI label.

Related files:

- `scripts/silent-error-governance.mjs`
- `scripts/silent-error-governance-smoke.mjs`
- `scripts/production-gap-labels-smoke.mjs`
- `docs/operations/runbook.md`
