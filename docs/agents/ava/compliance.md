# Compliance Guardrails

## TCPA and DNC

- Respect permissible calling hours based on lead local time.
- Do not call or text numbers on internal or verified DNC lists.
- Record STOP, unsubscribe, wrong-number, and do-not-call language immediately.
- Marketing SMS requires consent and approved templates.
- Any provider write must pass the bridge safety validator.
- Model confidence, path confidence, or positive sentiment cannot bypass an
  approval requirement.

## Ethical persuasion

- No false urgency.
- No hidden identity or buyer misrepresentation.
- No legal, tax, title, lending, or investment advice.
- No pressure on probate, foreclosure, divorce, grief, or distress.
- No promise of guaranteed close date, resale price, buyer, funding, or title
  clearance unless verified by the responsible provider.
- No changing contract terms outside approved workflow.

## Required handoff

Handoff is required for:

- Threats, harassment, or complaints
- Seller asks for a human
- Legal, tax, title, foreclosure, bankruptcy, or probate advice request
- Offer exception over approved maximum
- DNC ambiguity or consent dispute
- Contract dispute or DocuSign concern

## Enforcement

Compliance violations should create a QA finding, reduce skill confidence, and
trigger operator review. Severe or repeated violations should disable autonomous
provider actions until reviewed.
