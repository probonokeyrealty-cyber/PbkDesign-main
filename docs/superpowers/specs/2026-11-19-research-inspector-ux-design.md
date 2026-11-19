# Research inspector clarity

The founder asked to continue improving the Command Center experience, preserving the original design. Standing direction opts into autonomous refinement. This slice improves the existing explicit research inspector, not its provider permissions or execution capabilities.

## Approaches

Add a new research dashboard, expand tool execution, or refine the current inspector. Choose the current inspector: the existing Fleet/Brain/approval seams already own the workflow, while production Composio credentials remain separately pending approval. Extra navigation and execution do not solve inspection clarity.

## Design

Keep the closed native disclosure, current controls, PBK graphite/sky/amber tokens and original typography. Add a compact heading row with a read-only badge. Give catalog state a bordered chip; matched uses sky, uninspected is neutral, blocked/failure states use amber without claiming readiness. Add fixed, status-specific next-step copy. A not-configured state says an administrator must configure access; disabled means an administrator must enable inspection; authorization failure asks for administrator review; transient failures allow another explicit click; matched points to the read-only preview. No links or buttons initiate configuration, provider execution, refresh or follow-up.

Render checkedAt in the browser's local date/time with a timezone label and retain the original ISO in datetime/title. Missing or invalid dates remain Never checked. No timer, polling or auto-refresh. Keep previous snapshots on failed retries, redact arbitrary provider prose and reset on agent/lead changes.

## Acceptance

Existing 24 browser tests remain green. Add meaningful browser coverage for all fixed status guidance, neutral/matched/warning tone, accessible busy state, local timestamp with exact machine-readable original and zero extra invokes. Full Fleet desktop/WebKit390/Chromium320 proof must retain original controls, 44px targets and no viewport overflow. Type/lint/build and final independent review precede release. No backend, auth, CRM, provider keys, approvals or runtime source fingerprints change.
