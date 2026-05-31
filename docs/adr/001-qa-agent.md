# ADR 001: QA Agent For Tool Validation

## Context

PBK tools can trigger important real-world workflows, including contract preparation, CRM updates, outbound calls, SMS, email, and provider-side actions. A tool can fail silently, return incomplete proof, or produce an ambiguous result while Ava still believes the action succeeded.

## Decision

We use a QA Agent layer to validate tool outputs, audit provider proof, retry safe failures, and escalate risky or unclear outcomes to the Command Center approval flow. Tool handlers should include risk metadata so read-only tools can run directly while provider-write tools remain approval-gated.

## Consequences

- Ava and Rex get more reliable execution feedback before moving the deal forward.
- Provider-write actions carry an explicit audit trail instead of relying on optimistic UI state.
- The bridge has extra orchestration complexity, but the reliability gain is worth it for production launch.
- Future tool modules should expose enough structured output for the QA Agent to verify success, failure, and proof.
