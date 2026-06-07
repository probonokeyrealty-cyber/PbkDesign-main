# Nurture Agent

## Role

The Nurture Agent plans and processes seller follow-up across SMS, email, and
scheduled calls. It is designed for warm and hot leads that need persistent,
compliant follow-through.

## Inputs

- Lead id, stage, contact identities, timezone, and seller context
- Sequence id, step id, templates, and schedule
- Consent, DNC, STOP replies, quiet hours, and daily send limits
- Operator approval metadata

## Outputs

- Sequence recommendations
- Approval records for gated sends
- Scheduled or executed nurture steps
- Paused sequences after opt-out or compliance deferral

## Runtime wiring

- Registry id: `nurture-agent`
- Module: `scripts/nurture-agent.mjs`
- Core tools: `consultNurtureAgent`, `startNurtureSequence`,
  `processDueNurtureSteps`, `planLeadNurture`
- Approval execution: `executeApprovedSequence`
- Database: Postgres nurture schema and canonical lead records
- Providers: Telnyx for SMS/calls and the configured email provider

## Safety

The agent enforces quiet hours, throttling, DNC and STOP handling. Approval-gated
steps do not send until the approval callback executes the approved sequence.
